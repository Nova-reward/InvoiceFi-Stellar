# Adversarial Test Suite — InvoiceFi-Stellar Soroban Contracts

This directory documents every attack scenario exercised by the adversarial
integration test suite located at
`contracts/adversarial-tests/tests/adversarial_tests.rs`.

The suite is a dedicated Cargo crate (`adversarial-tests`) that lives in the
workspace and is executed as part of the contract CI gate on every pull request
that touches `contracts/**`.

---

## Threat Model Summary

The InvoiceFi-Stellar protocol involves three on-chain contracts:

| Contract | Threat surface |
|---|---|
| `invoice` | Unauthorized minting, invalid lifecycle transitions, ownership manipulation, spam funding |
| `financing-pool` | Reentrancy via token callbacks, oracle staleness, liquidity over-commitment, unauthorized role operations |
| `settlement` | Nonce replay, reentrancy via financing-pool callback, amount manipulation, unauthorized settle calls |

All three contracts share the `access-control` crate for role-based
authorization (admin signer set, `LiquidityManager`, `Pauser`, `OracleWriter`)
and a reentrancy guard that flips to `Locked` before any cross-contract call
and back to `Unlocked` after.

---

## Mock Malicious Contracts

### `MaliciousTokenContract`

Simulates an adversary-controlled token whose `transfer` function attempts to
re-enter the financing pool's `deposit` / `withdraw` endpoints from inside a
token callback, and also attempts to re-enter `settlement::settle_invoice`.

**Key methods:**

| Method | Target | Intent |
|---|---|---|
| `transfer(pool_id, caller, amount)` | `financing-pool::deposit` | Trigger pool reentrancy via token callback |
| `transfer_settlement(settlement_id, caller, invoice_id)` | `settlement::settle_invoice` | Trigger settlement reentrancy via pool notification callback |

### `MaliciousCaller`

Submits deliberately malformed arguments (zero amounts, negative amounts,
non-existent invoice IDs) directly to the three contracts through their
published client interfaces, verifying that every guard returns the correct
error variant rather than panicking with an opaque host error.

---

## Attack Scenarios

### Scenario 1 — Pool reentrancy guard blocks reentrant `deposit`

| | |
|---|---|
| **Attack** | Lock the financing-pool's reentrancy guard (simulating the moment a token callback fires mid-deposit) and call `deposit` again. |
| **Expected** | `Error::ReentrancyDetected` — pool state unchanged. |
| **Defense** | `StorageKey::reentrancy_guard()` flips to `Locked` before the cross-contract token-transfer event; any call that observes `Locked` returns immediately. |

---

### Scenario 2 — Pool reentrancy guard blocks reentrant `withdraw`

| | |
|---|---|
| **Attack** | Lock the reentrancy guard mid-withdraw and attempt a second `withdraw`. |
| **Expected** | `Error::ReentrancyDetected` — LP balance unchanged. |
| **Defense** | Same guard mechanism as Scenario 1. |

---

### Scenario 3 — Settlement reentrancy guard blocks reentrant `settle_invoice`

| | |
|---|---|
| **Attack** | Lock the settlement's `StorageKey::ReentrancyGuard` and call `settle_invoice` from inside the financing-pool notification callback window. |
| **Expected** | Contract panics with `REENTRANCY_DETECTED` — invoice `principal_paid` unchanged. |
| **Defense** | Settlement sets `ReentrancyGuard::Locked` before emitting the `notify_financing_pool` event; any re-entrant call that arrives while `Locked` panics. |

---

### Scenario 4 — Zero and negative amounts rejected across all three contracts

| Sub-case | Entry point | Error |
|---|---|---|
| 4a | `invoice::mint` with `amount = 0` | `InvoiceError::InvalidAmount` |
| 4b | `invoice::mint` with `amount = -100` | `InvoiceError::InvalidAmount` |
| 4c | `pool::deposit` with `amount = 0` | `PoolError::InvalidAmount` |
| 4d | `pool::deposit` with `amount = -1` | `PoolError::InvalidAmount` |
| 4e | `pool::withdraw` with `amount = 0` | `PoolError::InvalidAmount` |
| 4f | `pool::fund_invoice` with `face_value = 0` | `PoolError::InvalidAmount` |
| 4g | `pool::fund_invoice` with `face_value = -500` | `PoolError::InvalidAmount` |

---

### Scenario 5 — Settlement rejects zero and excessive settlement amounts

| Sub-case | Condition | Defense |
|---|---|---|
| 5a | `amount = 0` | Panics `INVALID_AMOUNT` |
| 5b | `amount > invoice.amount` | Panics `INVALID_AMOUNT` |

---

### Scenario 6 — Unauthorized role escalation attempts

| Sub-case | Entry point | Attacker | Error |
|---|---|---|---|
| 6a | `invoice::fund` | No roles | `InvoiceError::Unauthorized` |
| 6b | `invoice::update_status` | Non-admin | `InvoiceError::Unauthorized` |
| 6c | `invoice::pause` | Non-pauser | `InvoiceError::Unauthorized` |
| 6d | `pool::fund_invoice` | No LiquidityManager | `PoolError::Unauthorized` |
| 6e | `pool::set_price_feed` | Non-admin | `PoolError::Unauthorized` |

---

### Scenario 7 — Invalid invoice state-machine transitions

| Sub-case | Transition attempted | Error |
|---|---|---|
| 7a | `Pending → Settled` (skipping Funded) | `InvalidTransition` |
| 7b | Re-funding an already-Funded invoice | `InvalidTransition` |
| 7c | `Settled → Defaulted` (terminal state) | `InvalidTransition` |
| 7d | `Defaulted → Funded` (terminal state) | `InvalidTransition` |

The state machine enforces: `Pending→Funded` (via `fund()`),
`Pending→Defaulted`, `Funded→Settled`, `Funded→Defaulted`. All other
transitions are invalid.

---

### Scenario 8 — Nonce replay attack in `settle_invoice`

| | |
|---|---|
| **Attack** | Re-submit `settle_invoice` with a nonce that has already been consumed in a previous call. |
| **Expected** | Panics `NONCE_REPLAY` — the `used_nonces` set in `NonceMeta` prevents double-spending. |
| **Defense** | `NonceMeta::is_valid` rejects any nonce already present in `used_nonces`. |

---

### Scenario 9 — Self-transfer and transfer after settlement

| Sub-case | Condition | Error |
|---|---|---|
| 9a | `transfer(owner, owner, id)` | `SameOwnerTransfer` |
| 9b | `transfer` on a Settled invoice | `TransferAfterRepayment` |

---

### Scenario 10 — `transfer_from` without prior approval

| Sub-case | Condition | Error |
|---|---|---|
| 10a | `transfer_from` with no approval set | `NotApproved` |
| 10b | `transfer_from` with the wrong spender address | `NotApproved` |

---

### Scenario 11 — Stale oracle price feed blocks `fund_invoice`

| Sub-case | Condition | Error |
|---|---|---|
| 11a | No price feed set at all | `StalePriceFeed` |
| 11b | Feed timestamp > `MAX_PRICE_AGE_LEDGERS` (100) ledgers old | `StalePriceFeed` |
| 11c | Fresh feed at current ledger → succeeds | — |

An attacker who controls the oracle adapter cannot use a stale price to
unfairly fund invoices at a stale exchange rate.

---

### Scenario 12 — Double-funding the same invoice in the pool

| | |
|---|---|
| **Attack** | Call `fund_invoice` twice with the same `invoice_id`. |
| **Expected** | `PoolError::AlreadyFunded` on the second call. |
| **Defense** | `DataKey::Funding(invoice_id)` is a write-once key; presence check fires before any state change. |

---

### Scenario 13 — Operations on non-existent invoice IDs

| Sub-case | Entry point | Error |
|---|---|---|
| 13a | `invoice::get_invoice(999)` | `InvoiceNotFound` |
| 13b | `invoice::fund(999)` | `InvoiceNotFound` |
| 13c | `invoice::update_status(999)` | `InvoiceNotFound` |
| 13d | `invoice::owner_of(999)` | `InvoiceNotFound` |
| 13e | `invoice::get_invoice_token(999)` | `NotTokenized` |

---

### Scenario 14 — Paused contracts reject all state mutations

| Sub-case | Contract | Entry point | Error |
|---|---|---|---|
| 14a | `invoice` | `mint` | `ContractPaused` |
| 14b | `invoice` | `fund` | `ContractPaused` |
| 14c | `pool` | `deposit` | `ContractPaused` |
| 14d | `pool` | `withdraw` | `ContractPaused` |

The test also verifies that `unpause` restores normal operation.

---

### Scenario 15 — Double-initialize rejected

| Sub-case | Contract | Error |
|---|---|---|
| 15a | `invoice` | `AlreadyInitialized` |
| 15b | `financing-pool` | `AlreadyInitialized` |

---

### Scenario 16 — Insufficient pool liquidity prevents over-advancing

| | |
|---|---|
| **Attack** | Request `fund_invoice` for a face value larger than the pool's available liquidity. |
| **Expected** | `PoolError::InsufficientLiquidity`. |
| **Defense** | `available < advance` check in `fund_invoice`. |

---

### Scenario 17 — Withdraw exceeding deposited balance

| | |
|---|---|
| **Attack** | Call `withdraw` for an amount greater than the LP's recorded balance. |
| **Expected** | `PoolError::InsufficientBalance`. |

---

### Scenario 18 — Discount rate at or above 100 % rejected

| Sub-case | `discount_rate` | Error |
|---|---|---|
| 18a | 10 000 bps (100 %) | `InvalidDiscountRate` |
| 18b | 20 000 bps (200 %) | `InvalidDiscountRate` |

---

### Scenario 19 — Settling a non-existent invoice panics

| | |
|---|---|
| **Attack** | Call `settle_invoice` with a valid nonce but an invoice ID that was never registered via `set_invoice_data`. |
| **Expected** | Panics `INVOICE_NOT_FOUND`. |

---

### Scenario 20 — `set_token_address` requires admin role

| | |
|---|---|
| **Attack** | Non-admin calls `pool::set_token_address`. |
| **Expected** | `PoolError::Unauthorized`. |

---

## Running the Suite

```bash
# From the contracts/ workspace root:
cargo test -p adversarial-tests --test adversarial_tests -- --nocapture

# Or run the full workspace test suite (includes adversarial tests):
cargo test --all
```

---

## CI Integration

The adversarial suite is automatically executed by the
`.github/workflows/soroban-ci.yml` workflow on every pull request that
touches `contracts/**`. The step runs:

```bash
cargo test --all
```

which includes the `adversarial-tests` workspace member. A dedicated step
in `contracts.yml` also runs:

```bash
cargo test -p adversarial-tests --all-targets
```

to give targeted failure messages in the CI log.

---

## Extending the Suite

1. Add a new `#[test]` function to `tests/adversarial_tests.rs`.
2. Assign the next scenario number (currently up to 20).
3. Update this README with a new row in the relevant section.
4. Ensure the scenario name and contract it targets are clearly stated.

Security contributors: please reference the
[threat model](../../docs/security/threat-model.md) and the
[cross-contract reentrancy audit](../../docs/audits/cross-contract-reentrancy-audit.md)
when adding new scenarios.
