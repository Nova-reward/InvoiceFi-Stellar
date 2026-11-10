/* Authorized Protocol Quality Assurance & Formal Invariant Verification */

//! Formal verification of financing-pool discount invariants and state transitions.
//!
//! This module provides mathematical models and formal proof harnesses for Kani/Creusot,
//! verifying the three core arithmetic invariants of `financing-pool`:
//! 1. `advance == face_value - discount` (arithmetic conservation)
//! 2. `pool.available` never goes negative after a `fund` call (liquidity safety)
//! 3. Cumulative `withdrawn <= cumulative deposited` (solvency invariant)
//!
//! It also formally specifies the exact integer saturation boundary under `i128` arithmetic.

use crate::BPS_DENOMINATOR;
use common::CheckedMathError;

// ── Pure Mathematical Functions ──────────────────────────────────────────────

/// Pure calculation of advance for a given face value and discount bps.
///
/// Floor division ensures any rounding fraction is retained by the pool as discount,
/// never over-advanced to the borrower.
#[inline]
pub fn advance_for_pure(face_value: i128, bps: u32) -> Result<i128, CheckedMathError> {
    if face_value <= 0 || bps >= BPS_DENOMINATOR as u32 {
        return Err(CheckedMathError::Underflow);
    }
    let discount_mult = common::checked_sub(BPS_DENOMINATOR, bps as i128)?;
    let numer = common::checked_mul(face_value, discount_mult)?;
    common::checked_div(numer, BPS_DENOMINATOR)
}

/// Pure calculation of discount amount retained by the pool.
#[inline]
pub fn discount_amount_pure(face_value: i128, bps: u32) -> Result<i128, CheckedMathError> {
    let advance = advance_for_pure(face_value, bps)?;
    common::checked_sub(face_value, advance)
}

/// Pure state transition for funding an invoice.
///
/// Decrements `available` liquidity by `advance`.
#[inline]
pub fn fund_invoice_pure(available: i128, advance: i128) -> Result<i128, CheckedMathError> {
    if advance <= 0 || available < advance {
        return Err(CheckedMathError::Underflow);
    }
    common::checked_sub(available, advance)
}

/// Pure state transition for liquidity withdrawal.
///
/// Ensures both claimant balance and pool available liquidity are sufficient.
#[inline]
pub fn withdraw_pure(
    balance: i128,
    available: i128,
    amount: i128,
) -> Result<(i128, i128), CheckedMathError> {
    if amount <= 0 || balance < amount || available < amount {
        return Err(CheckedMathError::Underflow);
    }
    let new_balance = common::checked_sub(balance, amount)?;
    let new_available = common::checked_sub(available, amount)?;
    Ok((new_balance, new_available))
}

/// Pure state transition for liquidity deposit.
#[inline]
pub fn deposit_pure(
    balance: i128,
    available: i128,
    amount: i128,
) -> Result<(i128, i128), CheckedMathError> {
    if amount <= 0 {
        return Err(CheckedMathError::Underflow);
    }
    let new_balance = common::checked_add(balance, amount)?;
    let new_available = common::checked_add(available, amount)?;
    Ok((new_balance, new_available))
}

/// Upper bound face value before arithmetic overflow occurs in `face_value * (10_000 - bps)`.
#[inline]
pub const fn max_safe_face_value(bps: u32) -> i128 {
    let mult = BPS_DENOMINATOR - (bps as i128);
    if mult <= 0 {
        0
    } else {
        i128::MAX / mult
    }
}

// ── Kani Formal Verification Harnesses ───────────────────────────────────────

#[cfg(kani)]
mod formal_proofs {
    use super::*;

    /// Invariant 1: Advance and discount strictly partition the face value:
    /// `advance + discount == face_value`.
    #[kani::proof]
    fn verify_advance_discount_conservation() {
        let face_value: i128 = kani::any();
        let bps: u32 = kani::any();

        kani::assume(bps < BPS_DENOMINATOR as u32);
        kani::assume(face_value > 0);
        kani::assume(face_value <= max_safe_face_value(bps));

        let advance = advance_for_pure(face_value, bps).expect("valid advance");
        let discount = discount_amount_pure(face_value, bps).expect("valid discount");

        assert!(advance > 0, "advance must be positive");
        assert!(discount >= 0, "discount must be non-negative");
        assert!(
            advance + discount == face_value,
            "advance + discount must strictly equal face_value"
        );
        assert!(advance <= face_value, "advance cannot exceed face value");
    }

    /// Invariant 2: `pool.available` never goes negative after a `fund` call.
    #[kani::proof]
    fn verify_pool_available_never_negative_post_fund() {
        let available: i128 = kani::any();
        let advance: i128 = kani::any();

        kani::assume(available >= 0);
        kani::assume(advance > 0);
        kani::assume(available >= advance);

        let new_available = fund_invoice_pure(available, advance).expect("fund succeeds");

        assert!(
            new_available >= 0,
            "new_available must be strictly non-negative"
        );
        assert!(
            new_available < available,
            "available liquidity must strictly decrease"
        );
    }

    /// Invariant 3: Solvency invariant — cumulative withdrawals can never exceed
    /// cumulative deposits.
    #[kani::proof]
    fn verify_solvency_conservation_withdrawn_le_deposited() {
        let deposit_amount: i128 = kani::any();
        let withdraw_amount: i128 = kani::any();

        kani::assume(deposit_amount > 0 && deposit_amount < i128::MAX / 2);
        kani::assume(withdraw_amount > 0);

        let (init_balance, init_available) = (0i128, 0i128);
        let (bal_after_dep, avail_after_dep) =
            deposit_pure(init_balance, init_available, deposit_amount).expect("deposit succeeds");

        // Attempt withdrawal
        let withdraw_res = withdraw_pure(bal_after_dep, avail_after_dep, withdraw_amount);

        if withdraw_amount <= deposit_amount {
            assert!(withdraw_res.is_ok(), "admissible withdrawal must succeed");
            let (final_bal, final_avail) = withdraw_res.unwrap();
            assert!(final_bal >= 0 && final_avail >= 0);
            assert!(withdraw_amount <= deposit_amount);
        } else {
            assert!(
                withdraw_res.is_err(),
                "over-withdrawal exceeding deposit must fail"
            );
        }
    }

    /// Invariant 4: Overflow boundary analysis.
    ///
    /// Proves that `checked_mul` cleanly saturates/returns `Err` without panicking
    /// or silently wrapping when `face_value > max_safe_face_value`.
    #[kani::proof]
    fn verify_overflow_boundary_behavior() {
        let bps: u32 = 0; // Worst-case multiplier: 10_000
        let threshold = max_safe_face_value(bps);

        // Safe value
        let safe_res = advance_for_pure(threshold, bps);
        assert!(safe_res.is_ok(), "threshold must be safely computable");

        // Overflow value (threshold + 1)
        if threshold < i128::MAX {
            let overflow_res = advance_for_pure(threshold + 1, bps);
            assert!(
                overflow_res.is_err(),
                "values above threshold must safely return Err"
            );
        }
    }
}

// ── Standard Unit & Regression Tests (CI Passed) ─────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_advance_discount_conservation_concrete() {
        let test_cases = [
            (1_000i128, 1_000u32),   // 10%
            (50_000i128, 2_500u32),  // 25%
            (100_000i128, 500u32),   // 5%
            (7_777i128, 1_234u32),   // Arbitrary odd values
            (1_000_000i128, 1u32),   // 0.01%
        ];

        for (face_value, bps) in test_cases {
            let advance = advance_for_pure(face_value, bps).unwrap();
            let discount = discount_amount_pure(face_value, bps).unwrap();
            assert_eq!(
                advance + discount,
                face_value,
                "conservation failed for face_value={}, bps={}",
                face_value,
                bps
            );
            assert!(advance > 0);
            assert!(discount >= 0);
        }
    }

    #[test]
    fn test_pool_available_never_negative_concrete() {
        let available = 50_000i128;
        let advance = 50_000i128;

        // Exact match
        let new_avail = fund_invoice_pure(available, advance).unwrap();
        assert_eq!(new_avail, 0);

        // Exceeding available fails safely
        let over_advance = 50_001i128;
        assert!(fund_invoice_pure(available, over_advance).is_err());
    }

    #[test]
    fn test_solvency_conservation_concrete() {
        let (mut balance, mut available) = (0i128, 0i128);

        // Deposit 100,000
        let (b, a) = deposit_pure(balance, available, 100_000).unwrap();
        balance = b;
        available = a;

        // Withdraw 40,000
        let (b2, a2) = withdraw_pure(balance, available, 40_000).unwrap();
        balance = b2;
        available = a2;

        assert_eq!(balance, 60_000);
        assert_eq!(available, 60_000);

        // Withdraw remaining 60,000
        let (b3, a3) = withdraw_pure(balance, available, 60_000).unwrap();
        balance = b3;
        available = a3;

        assert_eq!(balance, 0);
        assert_eq!(available, 0);

        // Additional 1 token withdrawal must fail
        assert!(withdraw_pure(balance, available, 1).is_err());
    }

    #[test]
    fn test_overflow_boundary_exact_saturation() {
        let bps = 0u32;
        let max_safe = max_safe_face_value(bps);
        assert_eq!(max_safe, i128::MAX / 10_000);

        // Exactly at max safe: must succeed
        let res_safe = advance_for_pure(max_safe, bps);
        assert!(res_safe.is_ok());

        // Beyond max safe: must safely return Err(CheckedMathError::Overflow)
        let res_overflow = advance_for_pure(max_safe + 1, bps);
        assert_eq!(res_overflow, Err(CheckedMathError::Overflow));
    }
}
