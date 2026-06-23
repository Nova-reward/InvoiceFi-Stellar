# InvoiceFi-Stellar Backend

NestJS + Prisma (PostgreSQL) backend. Its primary job is to keep the off-chain
invoice records in sync with on-chain state — in particular, transitioning
invoices to `REPAID` when the settlement contract repays them on-chain (issue
#3) — and to serve invoice/dashboard data over REST.

## Stack

- **NestJS 11** — HTTP API + scheduled jobs
- **Prisma 6 / PostgreSQL** — persistence
- **@stellar/stellar-sdk** — Soroban RPC `getEvents` + XDR decoding
- **Jest** — unit tests

## Settlement event listener (issue #3)

`src/settlement/` polls Soroban RPC and applies settlements:

- `soroban-events.service.ts` — calls `rpc.Server.getEvents`, decodes each
  event's XDR topics/value into native values (`NormalizedEvent`).
- `settlement-event.parser.ts` — pure function that recognizes `InvoiceSettled`
  events and extracts the invoice id.
- `settlement.service.ts` — `settleInvoice()` transitions `FUNDED → REPAID` via
  a single conditional `updateMany` inside a transaction. **Atomic** (guarded on
  `status = FUNDED`) and **idempotent** (a replayed event for an already-`REPAID`
  invoice is a no-op).
- `settlement-sync.service.ts` — polls every `SETTLEMENT_POLL_INTERVAL_MS`
  (default 5s, so dashboards reflect settlement within ~10s). Each event is
  settled through `withRetry` (max 3 attempts, exponential backoff). The ledger
  cursor only advances past fully-processed ledgers, so a permanently-failing
  event is retried on the next cycle instead of being skipped.
- `sync-cursor.service.ts` — persists the last processed ledger (`SyncCursor`).

Dashboards read current status via `src/invoices/` REST endpoints:

| Method & path                          | Purpose                          |
| -------------------------------------- | -------------------------------- |
| `GET /health`                          | Liveness (used by compose).      |
| `GET /invoices`                        | All invoices.                    |
| `GET /invoices/:onchainId`             | Single invoice by on-chain id.   |
| `GET /dashboard/farmer/:address`       | A farmer's invoices.             |
| `GET /dashboard/investor/:address`     | An investor's invoices.          |

## Environment

See the repo-root `.env.example`. Key variables: `DATABASE_URL`,
`STELLAR_RPC_URL`, `PORT`, and optional listener tuning:

| Variable                       | Default | Meaning                                   |
| ------------------------------ | ------- | ----------------------------------------- |
| `INVOICE_CONTRACT_ID`          | (all)   | Comma-separated contract ids to filter.   |
| `SETTLEMENT_POLL_INTERVAL_MS`  | `5000`  | Listener poll interval.                   |
| `SETTLEMENT_MAX_ATTEMPTS`      | `3`     | Retry attempts per event.                 |
| `SETTLEMENT_RETRY_BASE_MS`     | `500`   | Backoff base delay.                       |

## Commands

```bash
npm install
npm run prisma:generate           # generate Prisma client
npm test                          # unit tests (no DB/chain needed)
npm run build                     # tsc -> dist/

# With a live PostgreSQL (DATABASE_URL set):
npx prisma migrate deploy         # apply migrations
npm start                         # node dist/main, listens on PORT (4000)
```

The included migration (`prisma/migrations/00000000000000_init`) was generated
with `prisma migrate diff`; on a fresh database `prisma migrate deploy` creates
the `Invoice` and `SyncCursor` tables.

## Tests

Unit tests run fully offline (Prisma and the Soroban RPC are mocked):

- `common/retry.spec.ts` — backoff, attempt cap, last-error propagation.
- `settlement/settlement-event.parser.spec.ts` — event recognition & id extraction.
- `settlement/settlement.service.spec.ts` — atomic transition, idempotency, error cases.
- `settlement/settlement-sync.service.spec.ts` — cursor advancement, retry, fail-and-resume.
