# Webhook Delivery API — Reference

This document specifies the webhook delivery system: registering an endpoint,
the delivery queue and retry behaviour, HMAC request signing, and the
delivery log API used to debug a subscriber-side failure. Implements
[issue #60](https://github.com/Nova-reward/InvoiceFi-Stellar/issues/60).

> **Scope.** Implemented: registration API, a persistent (Postgres-backed)
> delivery queue with fixed backoff retry, HMAC-SHA256 signing, and a
> queryable delivery log. Currently wired to one lifecycle event
> (`repaid`, emitted from `SettlementService` on a successful on-chain
> settlement); dispatching `created` / `submitted` / `funded` / `defaulted`
> only requires calling `WebhookDispatchService.dispatchInvoiceEvent` from
> wherever those transitions land once they exist server-side. Out of scope:
> WebSocket real-time push (see `src/notifications/`, currently unwired —
> [docs/EXCLUDED_MODULES.md](../EXCLUDED_MODULES.md)) and email/SMS channels.

## Contents

- [Authentication](#authentication)
- [Endpoints](#endpoints)
- [Event types](#event-types)
- [Delivery queue & retry schedule](#delivery-queue--retry-schedule)
- [Request signing](#request-signing)
- [Verifying a delivery (subscriber side)](#verifying-a-delivery-subscriber-side)
- [Duplicate suppression](#duplicate-suppression)
- [SSRF guard on registered URLs](#ssrf-guard-on-registered-urls)
- [Follow-ups](#follow-ups)

## Authentication

Every endpoint requires a valid HS256 JWT (the same token issued by
`POST /auth/connect-wallet`), supplied either as `Authorization: Bearer <jwt>`
or the `token` cookie. A caller may only register, list, revoke, or read the
delivery log of their **own** subscriptions (matched on `walletAddress`);
`admin` tokens may act on any wallet's subscriptions, and `GET /webhooks/subscriptions`
accepts `?ownerId=` for admins to inspect a specific wallet.

## Endpoints

| Method   | Path                                       | Description                                             |
| -------- | ------------------------------------------ | --------------------------------------------------------- |
| `POST`   | `/webhooks/subscriptions`                  | Register an endpoint. Response `secret` is shown once.    |
| `GET`    | `/webhooks/subscriptions`                  | List the caller's subscriptions.                          |
| `DELETE` | `/webhooks/subscriptions/:id`              | Deactivate a subscription (idempotent, `204`).             |
| `GET`    | `/webhooks/subscriptions/:id/deliveries`   | Delivery log, newest first. `?status=`, `?limit=` (≤200).  |

`POST /webhooks/subscriptions` body:

```json
{ "url": "https://example.com/hooks/invoicefi", "eventTypes": ["funded", "repaid"] }
```

`eventTypes` is optional; omitting it (or passing `["*"]`) subscribes to every
event type. A wallet may register at most 20 active subscriptions.

Response (only time `secret` is included):

```json
{
  "id": "b0b8...",
  "ownerId": "GFARMER...",
  "url": "https://example.com/hooks/invoicefi",
  "eventTypes": ["funded", "repaid"],
  "active": true,
  "createdAt": "2026-08-19T12:00:00.000Z",
  "updatedAt": "2026-08-19T12:00:00.000Z",
  "secret": "6c1f...e2"
}
```

## Event types

| Event       | Emitted from                                    |
| ----------- | ------------------------------------------------ |
| `created`   | Not yet wired server-side (see Scope, above).     |
| `submitted` | Not yet wired server-side.                        |
| `funded`    | Not yet wired server-side.                        |
| `repaid`    | `SettlementService.settleInvoice` on FUNDED→REPAID.|
| `defaulted` | Not yet wired server-side.                        |

Delivery payload (`InvoiceEvent`, `src/webhooks/webhook-event.types.ts`):

```json
{
  "invoiceId": "42",
  "event": "repaid",
  "timestamp": "2026-08-19T12:00:00.000Z",
  "data": { "ledger": 4242000 }
}
```

## Delivery queue & retry schedule

Enqueueing (`WebhookDispatchService.dispatchInvoiceEvent`) only writes a
`WebhookDelivery` row — it makes no HTTP request and cannot block or fail the
caller's transaction. `WebhookDeliveryWorkerService` polls every 15s for due
rows and delivers up to 20 concurrently, using
`SELECT ... FOR UPDATE SKIP LOCKED` to claim rows so that running multiple
backend instances never double-delivers the same row.

A failed attempt (network error, timeout, or non-2xx response) is retried on
a fixed schedule, then abandoned:

| Attempt | Delay before it   |
| ------- | ------------------ |
| 1       | immediate           |
| 2       | 1 minute             |
| 3       | 5 minutes            |
| 4       | 30 minutes           |
| 5       | 2 hours              |
| 6       | 12 hours             |
| 7       | 24 hours             |
| —       | abandoned, logged as an error, status → `ABANDONED` |

Every attempt (success or failure) is recorded as a `WebhookDeliveryAttempt`
row and exposed via `GET /webhooks/subscriptions/:id/deliveries`.

## Request signing

Every delivery is a `POST` with a JSON body and these headers:

| Header                       | Value                                         |
| ----------------------------- | ---------------------------------------------- |
| `X-InvoiceFi-Signature`       | `sha256=<hex hmac-sha256 of the raw body>`      |
| `X-InvoiceFi-Event`           | The event type (e.g. `repaid`).                 |
| `X-InvoiceFi-Delivery-Id`     | Stable across retries of the same delivery.     |
| `X-InvoiceFi-Timestamp`       | ISO-8601 timestamp of this specific attempt.    |

## Verifying a delivery (subscriber side)

```ts
import { createHmac, timingSafeEqual } from 'crypto';

function isValid(secret: string, rawBody: string, signatureHeader: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

Always verify against the **raw** request body bytes, before any JSON
parsing — a reserialization can change byte-for-byte content and break the
signature. The reference implementation lives in `src/webhooks/webhook-signing.ts`.

## Duplicate suppression

Two layers:

1. **Enqueue time** — each `WebhookDelivery` row's `idempotencyKey` is a hash
   of `invoiceId:event:timestamp`, unique per subscription. A lifecycle event
   emitted twice upstream enqueues at most once per subscriber.
2. **Claim time** — `SKIP LOCKED` ensures two backend instances never deliver
   the same queued row concurrently.

A subscriber may still see a duplicate delivery if a request succeeded but
the response was lost before the worker recorded it (classic at-least-once
semantics) — subscribers should treat `X-InvoiceFi-Delivery-Id` as an
idempotency key on their side for exactly-once processing.

## SSRF guard on registered URLs

Registration rejects URLs whose hostname is a literal loopback, RFC1918
private, or link-local address (including the `169.254.169.254` cloud
metadata endpoint) — see `src/webhooks/webhook-url.ts`. This is a static
check on the literal hostname; it does not resolve DNS, so it does not
protect against a hostname that resolves to a private address only at
delivery time (DNS rebinding). Follow-up, not a blocker for this feature.

## Follow-ups

- Wire `created` / `submitted` / `funded` / `defaulted` dispatch once those
  lifecycle transitions are implemented server-side (today, invoice creation
  and funding happen without a corresponding backend write — see
  [docs/EXCLUDED_MODULES.md](../EXCLUDED_MODULES.md)).
- Resolve-then-pin the registered URL's IP at delivery time to close the DNS
  rebinding gap noted above.
- Enqueueing a delivery currently happens just after the settlement
  transaction commits, not inside it; a crash in that narrow window would
  settle the invoice without enqueueing its webhook. Acceptable for now
  given the queue only carries notifications, not funds movement.
