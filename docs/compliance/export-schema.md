# Regulatory Disclosure Export API — Schema & Format Reference

This document specifies the regulatory export API: its endpoints, access
control, output schemas (JSON and CSV), and the cryptographic integrity proofs
that make every export audit-ready.

> **Scope.** Implemented: transaction history export, FATF Travel Rule fields,
> investor portfolio/P&L reports, access control, export signing, async jobs.
> Out of scope (tracked separately): direct regulator submission, KYC data
> collection, and GDPR right-to-erasure. See [Follow-ups](#follow-ups).

## Contents

- [Authentication & access control](#authentication--access-control)
- [Endpoints](#endpoints)
- [Integrity proofs](#integrity-proofs)
- [Transactions export (FATF Travel Rule)](#transactions-export-fatf-travel-rule)
- [Investor report (portfolio & P&L)](#investor-report-portfolio--pl)
- [Async jobs](#async-jobs)
- [Configuration](#configuration)
- [Verifying an export](#verifying-an-export)
- [Follow-ups](#follow-ups)

## Authentication & access control

Every endpoint requires a valid HS256 JWT (the same token issued by
`POST /auth/connect-wallet`), supplied either as `Authorization: Bearer <jwt>`
or the `token` cookie. The token must carry `sub`, `walletAddress`, and `role`.

Access is scoped by role:

| Role                | Transactions export                              | Investor report                        |
| ------------------- | ------------------------------------------------ | -------------------------------------- |
| `admin`             | Any `subject`, or **all** data (omit `subject`)  | Any investor (`subject` **required**)  |
| non-admin (self)    | Own wallet only; `subject` must be self or omitted | Own wallet only                       |

A non-admin requesting another `subject` receives **403 Forbidden**. Job status
and download are restricted to the requester (or an admin); a non-owner receives
**404** (existence is not disclosed).

## Endpoints

All paths are prefixed `/compliance/exports`.

| Method & path                     | Description                                                        |
| --------------------------------- | ----------------------------------------------------------------- |
| `GET /transactions`               | FATF Travel Rule fields for transfers ≥ threshold.                |
| `GET /investor-report`            | Investor portfolio with realized/unrealized P&L.                  |
| `GET /jobs/:id`                   | Poll an async export job's status.                                |
| `GET /jobs/:id/download`          | Download a completed job's signed document.                       |

### Query parameters

| Param       | Applies to        | Default             | Notes                                                        |
| ----------- | ----------------- | ------------------- | ------------------------------------------------------------ |
| `format`    | both exports      | `json`              | `json` or `csv`.                                             |
| `threshold` | transactions      | `FATF_TRAVEL_RULE_THRESHOLD` (`1000`) | Decimal, whole asset units. Transfers `>=` this are included. |
| `since`     | transactions      | —                   | ISO-8601 inclusive lower bound on transaction date.          |
| `until`     | transactions      | —                   | ISO-8601 inclusive upper bound on transaction date.          |
| `subject`   | both exports      | self / all          | Wallet to scope to (see access table).                       |
| `async`     | both exports      | `false`             | `true` enqueues a job and returns **202** with a `Location`. |

Small exports return the signed document inline (with a `Content-Disposition`
attachment). Large datasets should use `async=true` and the job endpoints.

## Integrity proofs

Every export document carries two independent proofs computed over the **exact
byte sequence** of the returned document:

- **SHA-256** digest (hex) — detects any tampering.
- **ed25519 signature** (base64) from the server's compliance key — proves
  origin. The signing key is a Stellar keypair; its public key is published as a
  Stellar `G...` address, so verifiers can use the Stellar SDK directly or decode
  it to a raw 32-byte ed25519 public key.

The proof is delivered **alongside** the document, never embedded in the signed
bytes, so the bytes a verifier hashes never depend on the proof itself.

Inline responses expose the proof as headers:

| Header                          | Meaning                                  |
| ------------------------------- | ---------------------------------------- |
| `X-Export-Digest-Algorithm`     | `sha256`                                 |
| `X-Export-Sha256`               | Hex SHA-256 of the body                  |
| `X-Export-Signature-Algorithm`  | `ed25519`                                |
| `X-Export-Signature`            | Base64 ed25519 signature of the body     |
| `X-Export-Signer`               | Signer public key (`G...`)               |

Job status/download responses carry the same values in the `integrity` object.

## Transactions export (FATF Travel Rule)

FATF Recommendation 16 ("Travel Rule") requires originator and beneficiary
information for value transfers at or above the threshold. Each financed invoice
yields up to two reportable transfers:

- **FINANCING** — investor (originator) → farmer (beneficiary), at funding.
- **REPAYMENT** — farmer/payer (originator) → investor (beneficiary), at
  settlement (only for `REPAID` invoices).

Un-funded (`PENDING`, no investor) invoices represent no transfer and are
excluded. Amounts use `fundedAmount`/`repaidAmount` when recorded, otherwise
fall back to `faceValue` (par).

### Record fields

| Field               | Type          | Description                                                     |
| ------------------- | ------------- | --------------------------------------------------------------- |
| `transactionRef`    | string        | Stable per-transfer id, `<onchainId>:<FINANCING\|REPAYMENT>`.    |
| `invoiceOnchainId`  | string        | On-chain invoice id.                                            |
| `transactionType`   | string        | `FINANCING` or `REPAYMENT`.                                     |
| `transactionDate`   | string (ISO)  | Best available transfer timestamp.                             |
| `ledgerSequence`    | number \| null | Settlement ledger (repayments only).                          |
| `invoiceStatus`     | string        | `PENDING`/`FUNDED`/`REPAID`/`DEFAULTED`.                        |
| `originatorAccount` | string        | Sender wallet.                                                  |
| `originatorName`    | string \| null | KYC-derived; `null` until KYC integration (see follow-ups).   |
| `beneficiaryAccount`| string        | Receiver wallet.                                               |
| `beneficiaryName`   | string \| null | KYC-derived; `null` for now.                                  |
| `amountMinorUnits`  | string        | Exact integer amount in the asset's minor units.              |
| `amountDecimal`     | string        | Human-readable decimal rendering.                             |
| `assetCode`         | string        | e.g. `USDC`.                                                    |
| `kycStatus`         | string        | `UNAVAILABLE` — marks that identity fields require KYC data.   |

The `null` name fields are emitted explicitly (rather than omitted) so the KYC
gap is visible in the export rather than silent.

### JSON envelope

```json
{
  "schemaVersion": "1.0",
  "exportType": "TRANSACTIONS",
  "generatedAt": "2026-07-20T12:00:00.000Z",
  "asset": { "code": "USDC", "decimals": 7 },
  "threshold": { "minorUnits": "10000000000", "decimal": "1000.0000000" },
  "scope": { "subject": null, "rangeStart": null, "rangeEnd": null },
  "recordCount": 1,
  "records": [ /* FATF records, fields as above */ ]
}
```

### CSV

The CSV body is the records only (RFC 4180, CRLF line endings). Column order is
exactly the field order in the table above. Envelope metadata (asset, threshold,
scope) is available via the JSON format and the job record / response headers.

## Investor report (portfolio & P&L)

### P&L methodology

- **cost basis** = `fundedAmount` when recorded, else `faceValue` (par).
- **proceeds** = `repaidAmount` when recorded, else `faceValue` at maturity.
- **realized P&L** accrues on `REPAID` invoices as `proceeds − cost basis`.
- **defaulted** invoices realize a loss equal to their cost basis.
- **open (`FUNDED`)** positions contribute `unrealizedValue = faceValue − cost basis`.

All monetary figures appear as both `minorUnits` (exact integer string) and
`decimal`.

### JSON envelope

```json
{
  "schemaVersion": "1.0",
  "exportType": "INVESTOR_REPORT",
  "generatedAt": "2026-07-20T12:00:00.000Z",
  "asset": { "code": "USDC", "decimals": 7 },
  "scope": { "subject": "GINVESTOR..." },
  "report": {
    "investor": "GINVESTOR...",
    "assetCode": "USDC",
    "positions": [
      {
        "invoiceOnchainId": "7",
        "status": "REPAID",
        "farmer": "GFARMER...",
        "assetCode": "USDC",
        "faceValueMinorUnits": "100000000",
        "costBasisMinorUnits": "95000000",
        "proceedsMinorUnits": "100000000",
        "realizedPnlMinorUnits": "5000000",
        "unrealizedValueMinorUnits": null,
        "fundedAt": "2026-01-01T00:00:00.000Z",
        "settledAt": "2026-02-01T00:00:00.000Z"
      }
    ],
    "summary": {
      "totalInvoices": 1,
      "fundedCount": 0,
      "repaidCount": 1,
      "defaultedCount": 0,
      "totalFaceValue": { "minorUnits": "100000000", "decimal": "10.0000000" },
      "totalCostBasis": { "minorUnits": "95000000", "decimal": "9.5000000" },
      "realizedProceeds": { "minorUnits": "100000000", "decimal": "10.0000000" },
      "realizedPnl": { "minorUnits": "5000000", "decimal": "0.5000000" },
      "outstandingCostBasis": { "minorUnits": "0", "decimal": "0.0000000" },
      "defaultedCostBasis": { "minorUnits": "0", "decimal": "0.0000000" },
      "unrealizedValue": { "minorUnits": "0", "decimal": "0.0000000" }
    }
  }
}
```

### CSV

The CSV body is the `positions` rows. Summary aggregates are available in the
JSON format and the job record.

## Async jobs

`GET /transactions?async=true` (or `investor-report`) enqueues a job and returns
**202 Accepted** with a `Location: /compliance/exports/jobs/<id>` header and a
job summary. Poll `GET /jobs/:id` until `status` is `COMPLETED` (or `FAILED`),
then `GET /jobs/:id/download`.

Job lifecycle: `PENDING → PROCESSING → COMPLETED | FAILED`. A `COMPLETED` job
exposes `integrity` and a `downloadUrl`; a `FAILED` job exposes `error`.

## Configuration

| Env var                       | Default   | Purpose                                                        |
| ----------------------------- | --------- | -------------------------------------------------------------- |
| `COMPLIANCE_SIGNING_SECRET`   | —         | Stellar secret seed (`S...`) for the ed25519 compliance key. Required in production; a random ephemeral key is used (with a warning) if unset. |
| `COMPLIANCE_ASSET_CODE`       | `USDC`    | Reporting asset code.                                          |
| `COMPLIANCE_ASSET_DECIMALS`   | `7`       | Minor-unit precision of the reporting asset.                   |
| `FATF_TRAVEL_RULE_THRESHOLD`  | `1000`    | Default Travel Rule threshold (decimal, whole asset units).    |
| `JWT_SECRET`                  | —         | Shared secret for verifying request tokens.                    |

## Verifying an export

Given the downloaded body bytes and the proof (headers or `integrity`):

```js
const { createHash } = require('crypto');
const { Keypair } = require('@stellar/stellar-sdk');

function verify(bodyBytes, sha256Hex, signatureB64, signerPublicKey) {
  const digest = createHash('sha256').update(bodyBytes).digest('hex');
  if (digest !== sha256Hex) return false;
  return Keypair.fromPublicKey(signerPublicKey).verify(
    bodyBytes,
    Buffer.from(signatureB64, 'base64'),
  );
}
```

## Follow-ups

- **KYC integration** — populate `originatorName`/`beneficiaryName` and address
  fields once KYC data collection lands; `kycStatus` will reflect availability.
- **GDPR right-to-erasure** — reconcile retention of `ExportJob.content` with
  erasure requests.
- **File-backed storage** — completed documents are currently stored in the
  `ExportJob.content` column; move very large exports to object storage.
- **Direct regulator submission** — out of scope here.
