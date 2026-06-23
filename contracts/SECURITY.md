# Security Audit – InvoiceFi Stellar Smart Contracts

## Overview

This document describes the authorization model, access controls, and anti-replay
measures implemented across all three InvoiceFi Stellar Soroban contracts:
`invoice`, `financing-pool`, and `settlement`.

---

## 1. Authorization Model

### 1.1 Role Hierarchy

| Role | Who Holds It | Privileges |
|------|-------------|-----------|
| **Admin** | Address set at deployment (`init()`) | Full contract control: mint invoices, approve investors, update settings, transfer admin |
| **Farmer / Issuer** | Invoice originator | Mint invoices, accept/reject/cancel/transfer own invoices |
| **Payee** | Invoice payee (receiver) | Transfer invoices, request settlement |
| **Buyer** | Invoice buyer (obligor) | Accept/reject/return invoices, request settlement |
| **Approved Investor** | Address approved by Admin | Deposit liquidity, fund invoices, release holdings |
| **Financier** | Invoice financier | Release investments, approve/reject funding |

### 1.2 Enforcement: `require_auth`

Every mutating Soroban entry point begins with:

```rust
caller.require_auth();
```

This is a Soroban primitive that verifies the transaction was signed by the caller
using the signature verification built into the Stellar protocol. If the signature
is absent or invalid the call reverts and no state changes occur.

The authorization check is **omitted only from read-only (view/pure) functions.**

---

## 2. Per-Contract Access Control

### 2.1 `invoice` Contract

| Function | Auth Required | Condition |
|----------|--------------|-----------|
| `init` | `caller.require_auth()` | caller == deployer |
| `mint_invoice` | `caller.require_auth()` | caller must be contract admin |
| `transfer_invoice` | `caller.require_auth()` | caller must be current issuer or buyer of the invoice |
| `cancel_invoice` | `caller.require_auth()` | caller must be the invoice issuer |
| `approve_invoice` | `caller.require_auth()` | caller must be the designated buyer |
| `accept_invoice` | `caller.require_auth()` | caller must be the invoice issuer |
| `reject_invoice` | `caller.require_auth()` | caller must be the buyer |
| `return_invoice` | `caller.require_auth()` | caller must be the buyer |
| `request_settlement_auth` | `caller.require_auth()` | caller must be issuer or payee |
| `set_invoice_merkle_root` | `caller.require_auth()` | caller must be admin |
| `add_user_tree_root` | `caller.require_auth()` | caller must be admin |
| `get_*` (all reads) | None | No auth needed |

**State-transition enforcement:** Even if authenticated, functions verify the invoice's
current `InvoiceStatus` before allowing transitions. Cancelling an already-rejected
invoice raises `CANNOT_CANCEL`; approving an already-approved invoice raises
`ALREADY_PROCESSED`.

### 2.2 `financing-pool` Contract

| Function | Auth Required | Condition |
|----------|--------------|-----------|
| `init` | `caller.require_auth()` | Deployer becomes admin |
| `approve_investor` / `reject_investor` | `caller.require_auth()` | caller must be admin |
| `issue_deposit` | `caller.require_auth()` | caller must hold `Active` (`status == 2`) investor registration |
| `close_deposit` | `caller.require_auth()` | caller must own an active deposit |
| `issue_certificate_against_deposit` | `caller.require_auth()` | caller must be admin |
| `request_investment_withdrawal` | `caller.require_auth()` | certificate must be active |
| `approve_investment_withdrawal` | `caller.require_auth()` | caller must be admin |
| `reject_investment_withdrawal` | `caller.require_auth()` | caller must be admin |
| `release_investment` | `caller.require_auth()` | caller must own the investment |
| `fund_invoice_request` | `caller.require_auth()` | investment must be in `Opened` state |
| `accept_funding` | `caller.require_auth()` | admin only |
| `reject_funding` | `caller.require_auth()` | admin only |
| `transfer_admin` | `caller.require_auth()` | caller must be current admin |
| `increment_wallet` | `caller.require_auth()` | admin only |
| `set_role` | `caller.require_auth()` | admin only |
| `update_settings` | `caller.require_auth()` | admin only |

Amount validations: `issue_deposit` rejects `amount <= 0`; `fund_invoice_request`
rejects `amount <= 0`.

### 2.3 `settlement` Contract

| Function | Auth Required | Condition |
|----------|--------------|-----------|
| `init` | `caller.require_auth()` | Deployer becomes admin |
| `set_authorized_payers` | `caller.require_auth()` | admin only |
| `set_financiers` | `caller.require_auth()` | admin only |
| `set_invoice_data` | `caller.require_auth()` | admin only |
| `set_fee_rate` | `caller.require_auth()` | admin only |
| `set_escrow_pubkey` | `caller.require_auth()` | admin only |
| `settlement_auth` | `caller.require_auth()` | caller must be buyer or payee |
| `request_settlement_auth` | `caller.require_auth()` | caller must be borrower or financier |
| `withdraw_fees` | `caller.require_auth()` | admin only |
| `settle_invoice` | `caller.require_auth()` | **PLUS nonce check** |

---

## 3. Nonce-Based Replay Protection (`settlement`)

### 3.1 Threat

Without replay protection, a valid `settle_invoice` call can be re-submitted on
chain multiple times, draining the financier multiple times for a single invoice.

### 3.2 Mechanism

Each `settle_invoice` call must carry a unique `nonce: u64`. The contract stores
the set of already-accepted nonces in persistent storage keyed by `invoice_id`.

```rust
StorageKey::nonce_meta(invoice_id) -> NonceMeta {
  invoice_id: Symbol,
  used_nonces: Vec<u64>,
  due_date: u64,        // Stored at invoice_set time
}
```

### 3.3 Validity Rules

A nonce is accepted if and only if:

1. **Unused**: `nonce` is not in the stored `used_nonces` list → prevents replay.
2. **Not expired**: current ledger timestamp ≤ `due_date + 2592000` (due_date + 30
   days) → bounds nonce storage lifetime; expired nonces can be cleaned up.

```rust
pub fn is_valid(&self, e: &Env, nonce: u64) -> bool {
    if self.used_nonces.contains(&nonce) { return false; }
    let deadline = self.due_date.saturating_add(2592000);
    let now: u64 = e.ledger().timestamp();
    now <= deadline
}
```

### 3.4 Storage Expiry

The 30-day window after `due_date` is the **binding lifetime** for a nonce entry.
Once the deadline passes, the nonce meta can be safely deleted:

```rust
NonceMeta { due_date: April 1, 2026 }
Expires: May 1, 2026 (April 1 + 2592000 s)
Expiry check: ledger time > May 1 → reject as expired
```

Clients can garbage-collect expired entries to bound storage growth (sorted by
`due_date + 30d`). There is no automatic on-chain TTL — cleanup happens lazily
on the next settlement attempt for the invoice.

### 3.5 `get_used_nonces` Auditability

```rust
fn get_used_nonces(e: Env, invoice_id: Symbol) -> Vec<u64>;
```

This read-only function returns all nonces already accepted for a given invoice.
Auditors and off-chain monitors can use this to verify settlement completeness and
detect unauthorized re-submissions.

---

## 4. Storage Key Naming Convention

All contracts use a uniform `StorageKey { category: Symbol, id: Symbol }` pattern.
Keys are prefixed by category to enable future access-list optimizations and to
prevent cross-contract key collisions in multi-contract deployments.

| Category | Example Key |
|----------|-------------|
| `INSTANCE:ADMIN` | Contract admin address |
| `INVOICE_DATA:<id>` | Full invoice record |
| `STATUS:<id>` | Numeric status code |
| `DUE_DATE:<id>` | Invoice due date |
| `USER_TREE:<addr>_<idx>` | Merkle tree root per user |
| `NONCE_META:<id>` | Nonce metadata (settlement) |
| `DEP_STATUS:<key>` | Deposit status (financing-pool) |
| `CERT_STATUS:<key>` | Certificate status |

---

## 5. Event Logging (Observability)

Every mutating operation emits a typed event:

```rust
e.events().publish((TOKEN, EVENT), payload);
```

Key events emitted per contract:

| Contract | Token | Event |
|----------|-------|-------|
| invoice | `invoice` | `minted`, `transferred`, `cancelled`, `approved`, `accepted`, `rejected`, `returned`, `settlement_auth_req`, `root_set`, `user_root_added` |
| financing-pool | `pool` | `deposit_issued`, `deposit_closed`, `cert_issued`, `withdrawal_req`, `withdrawal_approved`, `withdrawal_rejected`, `investment_released`, `invoice_funded`, `funding_accepted`, `funding_rejected`, `investor_approved`, `investor_rejected`, `admin_transferred`, `settings_updated` |
| settlement | `settlement` | `invoice_set`, `settled`, `auth_recorded`, `auth_requested`, `fees_withdrawn`, `fee_rate_set`, `escrow_set` |

Events are **non-repudiable**; they prove on-chain that the authenticated caller
performed the action at a specific ledger sequence.

---

## 6. Anti-Patterns Explicitly Avoided

| Pattern | Reason Rejected |
|---------|----------------|
| `unsafe` code | Soroban contract safety profile requires no unsafe |
| `panic!()` without require_auth before | Auth must be the very first check |
| Hardcoded addresses | Admin is set at deployment; no baked-in keys |
| Unbounded storage growth | Nonce entries expire 30 days post due-date |
| Signature check bypass | All `require_auth` calls happen before any business logic |
| Time-based replay without ledger timestamp | Uses `e.ledger().timestamp()` (Stellar consensus time) |

---

## 7. Test Coverage

Every `require_auth` guard is covered by a `#[test]` that:
1. Confirms the happy-path still succeeds.
2. Confirms `#[should_panic]` when the wrong (or unsigned) caller invokes the
   function.

Additionally, the nonce replay path is tested by:
- Calling `settle_invoice` with the same nonce twice (second call must fail).
- Verifying `get_used_nonces` returns the accepted nonces.

Run all contract tests:
```bash
cd contracts
cargo test --all
```

---

## 8. Security Checklist (Audit Sign-off)

- [x] Every mutating Soroban function calls `env.require_auth(&caller)`
- [x] Settlement `nonce` parameter accepted and validated before state changes
- [x] Used nonces persisted in contract instance storage
- [x] Reused nonce → contract reverts with `NONCE_REPLAY`
- [x] Nonce TTL = `due_date + 30 days` (2592000 s)
- [x] `get_used_nonces` read function exposed
- [x] Authorization model documented here (`SECURITY.md`)
- [x] All new auth/nonce checks have Rust `#[test]` coverage asserting `Unauthorized` on missing auth
