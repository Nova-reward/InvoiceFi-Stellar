# Audit and Hardening Report: Nonce Replay Protection in Settlement Contract

**Audit Date:** November 17, 2026  
**Auditor:** GreatKhalifa / Antigravity Security  
**Target:** `contracts/settlement/src/nonce.rs`, `contracts/settlement/src/lib.rs`, `contracts/settlement/src/upgrade_tests.rs`  
**Issue:** [#148 Audit and harden nonce replay protection in settlement/src/nonce.rs](https://github.com/Nova-reward/InvoiceFi-Stellar/issues/148)

---

## 1. Executive Summary

A targeted security audit of the nonce replay protection mechanism in the Settlement contract was conducted. The audit evaluated:
1. **Nonce issuance, consumption, and storage-key collision paths** across distinct `invoice_id` values sharing the same key prefix.
2. **Atomicity and TOCTOU (Time-of-Check to Time-of-Use) windows** within the Soroban invocation lifecycle during `settle_invoice`.
3. **Nonce persistence across contract upgrades** using the `upgrade_test_framework`.
4. **Behavior under concurrent / same-ledger batch submissions**.

Three findings were identified and resolved, with automated regression tests covering each scenario.

---

## 2. Findings Enumeration

| Finding ID | Title | Severity | Status |
|---|---|---|---|
| **SEC-NONCE-01** | Late Nonce Persistence After State Mutations (Checks-Effects-Interactions & TOCTOU Risk) | **Medium** | **Fixed** |
| **SEC-NONCE-02** | Default Zero Due Date in `NonceMeta::load` Fallback | **Medium** | **Fixed** |
| **SEC-NONCE-03** | Unused / Incomplete `NonceManager` Helper Module | **Low** | **Fixed** |
| **SEC-NONCE-04** | Storage Key Collision Verification across Invoices | **Informational** | **Verified Safe** |

---

## 3. Detailed Findings and Fixes

### Finding SEC-NONCE-01: Late Nonce Persistence After State Mutations (Checks-Effects-Interactions)
- **Severity:** Medium
- **Location:** `contracts/settlement/src/lib.rs` (lines ~455-507)
- **Description:**  
  In `settle_invoice`, nonce validation occurred early (`nm.is_valid`), but the updated nonce record `nm2` was written to storage (`persistent().set(&nonce_key, &nm2)`) at line 507, *after* mutating fee collection state, updating invoice principal, and saving the invoice record. If an external or internal handler interposed or panicked between line 455 and 507, or if control flow was interrupted, the nonce state was not immediately synchronized with validation.
- **Remediation:**  
  Rearranged `settle_invoice` so that:
  1. The invoice record is loaded first (verifying invoice existence).
  2. The nonce metadata is retrieved (or initialized with the invoice's authentic `due_date`).
  3. The nonce is validated and marked used *immediately*.
  4. The updated `NonceMeta` is committed to persistent storage before proceeding with fee calculations, invoice record updates, and external cross-contract notifications.

### Finding SEC-NONCE-02: Default Zero Due Date in `NonceMeta::load` Fallback
- **Severity:** Medium
- **Location:** `contracts/settlement/src/types.rs` & `contracts/settlement/src/lib.rs`
- **Description:**  
  When an invoice was registered via `set_invoice_data`, no `NonceMeta` was initially written until explicitly created or populated. Calling `NonceMeta::load` for an invoice that had no existing `NonceMeta` fell back to `NonceMeta::new(e, invoice_id, 0)`. With `due_date = 0`, the validity check `now <= due_date + 2592000` could immediately fail or expire on valid invoices unless manually initialized in testing.
- **Remediation:**  
  In `settle_invoice`, if `NonceMeta` does not yet exist in storage, it is initialized using the verified `record.due_date` from the persistent `InvoiceRecord`. This ensures legitimate settlement nonces are checked against the true invoice maturity and grace window.

### Finding SEC-NONCE-03: Unused / Incomplete `NonceManager` Helper Module
- **Severity:** Low
- **Location:** `contracts/settlement/src/nonce.rs`
- **Description:**  
  `settlement/src/nonce.rs` provided `NonceManager` with `record` and `is_valid`, but did not provide an atomic `check_and_record` utility method, causing `lib.rs` and tests to perform manual storage manipulation.
- **Remediation:**  
  Added `NonceManager::check_and_record(e, invoice_id, nonce, due_date) -> bool` to `nonce.rs`, which atomically checks validity, marks the nonce as consumed, and writes to storage in a single operation.

### Finding SEC-NONCE-04: Storage Key Collision Verification
- **Severity:** Informational
- **Location:** `contracts/settlement/src/types.rs` (`StorageKey::NonceMeta(Symbol)`)
- **Description:**  
  Soroban SDK serializes enum variants with distinct payload tags. `StorageKey::NonceMeta(Symbol)` and `StorageKey::InvoiceData(Symbol)` have different enum discriminants (variant indices `3` and `0` respectively).
- **Verification:**  
  Verified that distinct `invoice_id` symbols (e.g. `INV_A` vs `INV_B`) produce mutually exclusive storage keys. An invoice cannot consume or invalidate nonces of another invoice sharing the same prefix. Regression tests have been added in `tests.rs`.

---

## 4. Verification and Regression Tests

The following test suites were added / updated:

1. **Same Ledger Batch Nonce Replay Test:**  
   `test_same_invoice_nonce_cannot_be_submitted_twice_in_same_ledger` in `contracts/settlement/src/tests.rs` asserts that submitting the same `(invoice_id, nonce)` pair twice in immediate succession (same ledger transaction stream) fails on the second call without corrupting or modifying state.

2. **Nonce Isolation Across Invoices:**  
   `test_nonce_isolation_across_different_invoices` in `contracts/settlement/src/tests.rs` asserts that consuming a nonce on `INV_A` does not mark that nonce used on `INV_B`.

3. **Atomic NonceManager Validation:**  
   `test_nonce_manager_check_and_record` in `contracts/settlement/src/tests.rs` tests `NonceManager::check_and_record` for successful consumption and immediate rejection upon duplicate attempt.

4. **Upgrade Persistence Test:**  
   `test_nonce_state_persists_and_blocks_replay_through_upgrade` in `contracts/settlement/src/upgrade_tests.rs` asserts that:
   - Nonces consumed in v1 persist into v2 after WASM upgrade.
   - Replay attempts of pre-upgrade nonces are rejected post-upgrade.
   - Unused nonces can still be consumed normally post-upgrade.
