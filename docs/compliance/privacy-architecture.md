# Privacy Architecture

## Objective

Provide a documented, auditable privacy-control layer for personal data stored by the backend, covering:

- data inventory and retention policy definition
- automated retention enforcement
- right-to-erasure pseudonymization workflow
- data portability export
- technical privacy notice requirements

## Architecture

### Data collection boundary

Personal data enters the backend through the invoice off-chain mirror. The `Invoice` model stores wallet-based participant identifiers in the `farmer` and `investor` fields.

### Retention model

The backend applies a 365-day retention window to invoice participant identifiers.

- Data is retained as long as it is required for contract-processing, dispute handling, and settlement reconciliation.
- Once the retention threshold is reached, the scheduled cleanup job pseudonymizes those fields instead of deleting the invoice row, preserving associated on-chain event linkage.

### Right-to-erasure workflow

The API exposes `POST /compliance/erasure-requests`.

1. The caller submits a `userId` and reason.
2. The backend finds all invoice rows linked to that user identifier in either the `farmer` or `investor` role.
3. The backend updates the role-specific fields to deterministic pseudonymous values such as `farmer-redacted-<id>`.
4. The row is not deleted, so the immutable blockchain reference (`onchainId`) and processing history remain intact.
5. The endpoint returns a receipt object confirming the number of pseudonymized records.

### Data portability workflow

The API exposes `GET /compliance/data-export/:userId`.

- The service returns a machine-readable JSON object containing the exported data and all linked invoice records for the supplied user identifier.
- BigInt values are serialized to strings to ensure machine-readable output.

### Privacy notice requirements

The privacy notice must state:

- the categories of data processed for invoice settlement and financing workflows
- the retention period for wallet-derived identifiers
- the existence of automated pseudonymization after retention
- the right to request erasure or portability through the compliance API endpoints
- that immutable on-chain records are preserved as a ledger of contract activity and cannot be deleted by the backend

## Operational controls

- `ComplianceScheduler` runs daily at midnight and performs scheduled retention cleanup.
- The Prisma schema comments document the retention period and legal basis for all PII fields that are stored in the backend.
