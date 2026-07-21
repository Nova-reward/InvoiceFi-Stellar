# Data Inventory Audit

## Scope

This audit covers the Prisma-backed backend data currently used to represent invoice participants in the off-chain mirror of Soroban invoice activity.

## Inventory Table

| Prisma model | Field | Data category | Purpose | Retention period | Legal basis |
| --- | --- | --- | --- | --- | --- |
| `Invoice` | `farmer` | Wallet-derived identifier (personal data in the GDPR sense when tied to a natural person) | Identify the invoice originator for dashboarding, settlement tracing, and funding workflows | 365 days from `settledAt` or `createdAt`, whichever is later; then pseudonymize | Contract performance, settlement operations, fraud prevention |
| `Invoice` | `investor` | Wallet-derived identifier (personal data in the GDPR sense when tied to a natural person) | Identify the financing party for dashboarding, settlement tracing, and owner attribution | 365 days from `settledAt` or `createdAt`, whichever is later; then pseudonymize | Contract performance, settlement operations, fraud prevention |
| `SyncCursor` | `lastLedger` | Operational metadata | Track Soroban event ingestion progress | No personal data; retained only for sync continuity | System integrity |

## Notes

1. The backend does not persist separate profile records for farmers or investors. The invoice row stores the wallet address values used as the user-facing identity in the API and dashboard.
2. On-chain record immutability means the system cannot delete the `onchainId` event history. The Privacy-preserving workflow therefore pseudonymizes the off-chain personal data while keeping the immutable `onchainId` and invoice relationship intact.
3. Any future profile or contact data model must be added to this inventory before production rollout.
