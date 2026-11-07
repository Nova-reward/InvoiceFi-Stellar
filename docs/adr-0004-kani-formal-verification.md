# ADR 0004: Formal Verification of Financing-Pool Invariants with Kani

## Status
Accepted

## Context
The `financing-pool` smart contract manages token liquidity, investor deposits, and invoice advance funding on Stellar Soroban. The core value-retention and capital-safety properties of the protocol rely on three critical arithmetic invariants:
1. **Advance-Discount Conservation**: `advance == face_value - discount` (any integer rounding is retained by the pool and never over-advanced).
2. **Liquidity Non-Negativity**: `pool.available` never goes negative after any `fund_invoice` call.
3. **Solvency Guarantee**: Cumulative `withdrawn <= deposited`.

Traditional unit tests sample isolated inputs but cannot prove that edge-case combinations of `face_value` and `discount_bps` across the full 128-bit integer domain do not cause arithmetic overflow, underflow, or invariant violations.

## Decision
We implemented machine-checked formal verification harnesses using the **Kani Rust Verifier** (`cargo kani`), backed by bounded model checking and CBMC symbolic execution.

### Verification Architecture
1. **Pure Mathematical Mirror (`src/verification.rs`)**:
   - Extracted state transition handlers into pure, deterministic functions (`advance_for_pure`, `discount_amount_pure`, `fund_invoice_pure`, `withdraw_pure`, `deposit_pure`).
   - Modeled state mutations with zero Soroban host dependencies for hermetic formal reasoning.
2. **Kani Proof Harnesses (`#[cfg(kani)]`)**:
   - `verify_advance_discount_conservation`: Uses symbolic `kani::any()` inputs to prove conservation across all valid `face_value` and `bps` combinations.
   - `verify_pool_available_never_negative_post_fund`: Proves `available_post_fund >= 0` whenever `available >= advance`.
   - `verify_solvency_conservation_withdrawn_le_deposited`: Proves that withdrawal demands exceeding prior deposits strictly fail.
   - `verify_overflow_boundary_behavior`: Formally asserts the exact integer saturation threshold.

### Overflow Boundary Specification
In `financing-pool`, discount calculation performs:
$$\text{numer} = \text{face\_value} \times (10,000 - \text{bps})$$
For `i128` integers:
$$\text{MAX\_SAFE\_FACE\_VALUE}(\text{bps}) = \left\lfloor \frac{i128\text{::MAX}}{10,000 - \text{bps}} \right\rfloor$$

* **Worst-Case Threshold ($\text{bps} = 0$)**:
  $$\text{threshold} = \frac{170,141,183,460,469,231,731,687,303,715,884,105,727}{10,000} \approx 1.7014 \times 10^{34}$$
* **Behavior Beyond Boundary**:
  Because `common::checked_mul` is used throughout, values above the saturation boundary safely return `Err(CheckedMathError::Overflow)`. **The contract never panics or wraps silently.**

## Consequences
- Zero counterexamples found across all three invariants.
- CI gate established in `.github/workflows/kani-verify.yml` to automatically verify contract changes on PRs.
- Dual coverage: formal proofs compile under `#[cfg(kani)]` while concrete regression test suites run under standard `cargo test`.
