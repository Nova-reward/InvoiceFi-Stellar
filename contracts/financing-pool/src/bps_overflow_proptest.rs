//! Boundary/property tests for the BPS discount math in `advance_for`
//! (exercised through the public `initialize`/`quote`/`fund_invoice` API).
//!
//! See `docs/audits/financing-pool-bps-overflow.md` for the write-up of the
//! overflow this guards against: `face_value * (10_000 - discount_bps)` can
//! overflow `i128` *before* the `/ 10_000` is applied, for `face_value`
//! values large enough that no real invoice would ever reach in practice,
//! but which a caller (or a future contract bug) could still submit. The
//! contract must reject those with a typed [`Error::Overflow`], never panic
//! or silently wrap.

#![cfg(test)]

use super::{Error, FinancingPoolContract, FinancingPoolContractClient};
use access_control::MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS;
use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

/// `face_value` large enough to exercise realistic-to-large invoice values,
/// but small enough that `face_value * 10_000` (the worst case, at
/// `discount_bps = 0`) can never overflow `i128`, regardless of
/// `discount_bps`. Used for properties that assert *normal* behavior and
/// don't care about the overflow boundary itself.
const SAFE_MAX_FACE_VALUE: i128 = i128::MAX / 10_000;

/// Deploy a fresh pool at the given discount and quote `face_value` through
/// the real public API, decoding the client's `try_quote` `Result` down to
/// this crate's own `Result<i128, Error>`.
fn quote_for(discount_bps: u32, face_value: i128) -> Result<i128, Error> {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FinancingPoolContract, ());
    let client = FinancingPoolContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin);
    client.initialize(
        &signers,
        &1u32,
        &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS,
        &discount_bps,
    );
    match client.try_quote(&face_value) {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(e)) => panic!("quote: XDR conversion error decoding Ok: {e:?}"),
        Err(Ok(e)) => Err(e),
        Err(Err(e)) => panic!("quote: host invoke error: {e:?}"),
    }
}

fn discount_amount_for(discount_bps: u32, face_value: i128) -> Result<i128, Error> {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FinancingPoolContract, ());
    let client = FinancingPoolContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin);
    client.initialize(
        &signers,
        &1u32,
        &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS,
        &discount_bps,
    );
    match client.try_discount_amount(&face_value) {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(e)) => panic!("discount_amount: XDR conversion error decoding Ok: {e:?}"),
        Err(Ok(e)) => Err(e),
        Err(Err(e)) => panic!("discount_amount: host invoke error: {e:?}"),
    }
}

/// Deploy a pool, fund liquidity, set a fresh price feed, and attempt to
/// fund an invoice for `face_value`, returning the decoded
/// `Result<i128, Error>` for the advance.
fn fund_invoice_for(discount_bps: u32, face_value: i128) -> Result<i128, Error> {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FinancingPoolContract, ());
    let client = FinancingPoolContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(
        &signers,
        &1u32,
        &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS,
        &discount_bps,
    );
    client.set_price_feed(&admin, &1_000_000i128, &env.ledger().sequence());
    // Deposit enough liquidity to cover the advance regardless of discount:
    // `advance <= face_value` always, so `face_value` itself is a safe
    // upper bound and never overflows `Available`'s running total (it
    // starts at 0).
    let lp = Address::generate(&env);
    client.deposit(&lp, &face_value);
    let farmer = Address::generate(&env);
    match client.try_fund_invoice(&admin, &1u64, &face_value, &farmer) {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(e)) => panic!("fund_invoice: XDR conversion error decoding Ok: {e:?}"),
        Err(Ok(e)) => Err(e),
        Err(Err(e)) => panic!("fund_invoice: host invoke error: {e:?}"),
    }
}

/// `(discount_bps, overflow_threshold)` where `overflow_threshold` is the
/// largest `face_value` that does *not* overflow at that `discount_bps`
/// (i.e. `floor(i128::MAX / multiplier)`, `multiplier = 10_000 -
/// discount_bps`).
fn bps_and_threshold() -> impl Strategy<Value = (u32, i128)> {
    (0u32..10_000).prop_map(|bps| {
        let multiplier = (10_000 - bps) as i128;
        (bps, i128::MAX / multiplier)
    })
}

/// Same as [`bps_and_threshold`], restricted to `discount_bps <= 9_998`
/// (`multiplier >= 2`). At `discount_bps = 9_999` (`multiplier = 1`) the
/// threshold is `i128::MAX` itself and nothing can push a face value past
/// it — that case can never overflow at all (see
/// `threshold_boundary_exact_at_max_discount` below), so it's excluded from
/// strategies that construct a value meant to *exceed* the threshold.
fn bps_and_threshold_with_headroom() -> impl Strategy<Value = (u32, i128)> {
    (0u32..9_999).prop_map(|bps| {
        let multiplier = (10_000 - bps) as i128;
        (bps, i128::MAX / multiplier)
    })
}

/// `(discount_bps, face_value)` with `face_value` uniformly sampled from
/// `[1, overflow_threshold]` at that `discount_bps` — i.e. never overflows.
fn bps_and_face_value_at_or_below_threshold() -> impl Strategy<Value = (u32, i128)> {
    bps_and_threshold().prop_flat_map(|(bps, threshold)| (Just(bps), 1i128..=threshold))
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    /// The advance is always non-negative and never exceeds the face value,
    /// across the whole non-overflowing domain.
    #[test]
    fn advance_is_bounded_by_face_value(
        bps in 0u32..10_000,
        face_value in 1i128..=SAFE_MAX_FACE_VALUE,
    ) {
        let advance = quote_for(bps, face_value).unwrap();
        prop_assert!(advance >= 0);
        prop_assert!(advance <= face_value);
    }

    /// `discount_amount` and `quote` (both built on `advance_for`) always
    /// partition the face value exactly: nothing is lost or invented.
    #[test]
    fn discount_plus_advance_equals_face_value(
        bps in 0u32..10_000,
        face_value in 1i128..=SAFE_MAX_FACE_VALUE,
    ) {
        let advance = quote_for(bps, face_value).unwrap();
        let discount = discount_amount_for(bps, face_value).unwrap();
        prop_assert_eq!(advance + discount, face_value);
    }

    /// At `discount_bps = 0` the pool takes no cut: the advance is exactly
    /// the face value.
    #[test]
    fn zero_discount_returns_full_face_value(face_value in 1i128..=SAFE_MAX_FACE_VALUE) {
        prop_assert_eq!(quote_for(0, face_value).unwrap(), face_value);
    }

    /// For a fixed discount, the advance is monotonically non-decreasing in
    /// the face value.
    #[test]
    fn advance_monotonic_in_face_value(
        bps in 0u32..10_000,
        a in 1i128..=SAFE_MAX_FACE_VALUE,
        b in 1i128..=SAFE_MAX_FACE_VALUE,
    ) {
        let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
        prop_assert!(quote_for(bps, lo).unwrap() <= quote_for(bps, hi).unwrap());
    }

    /// For a fixed face value, the advance is monotonically non-increasing
    /// as the discount grows.
    #[test]
    fn advance_monotonic_in_discount_bps(
        face_value in 1i128..=SAFE_MAX_FACE_VALUE,
        bps_a in 0u32..10_000,
        bps_b in 0u32..10_000,
    ) {
        let (lo, hi) = if bps_a <= bps_b { (bps_a, bps_b) } else { (bps_b, bps_a) };
        prop_assert!(quote_for(hi, face_value).unwrap() <= quote_for(lo, face_value).unwrap());
    }

    /// Any face value at or below the exact per-discount overflow threshold
    /// succeeds — the checked multiplication never false-positives.
    #[test]
    fn no_overflow_at_or_below_threshold(
        (bps, face_value) in bps_and_face_value_at_or_below_threshold(),
    ) {
        prop_assert!(quote_for(bps, face_value).is_ok());
    }

    /// Any face value strictly above the per-discount overflow threshold is
    /// rejected with the typed `Overflow` error — never a panic, never a
    /// silently wrapped/truncated advance.
    #[test]
    fn overflow_strictly_above_threshold(
        (bps, threshold) in bps_and_threshold_with_headroom(),
        delta in 1i128..=1_000_000i128,
    ) {
        let face_value = threshold.saturating_add(delta).min(i128::MAX);
        prop_assert_eq!(quote_for(bps, face_value), Err(Error::Overflow));
    }

    /// Fuzz-style sweep across the *entire* `i128` domain (not just near a
    /// computed threshold): `quote` must always resolve to `Ok` or
    /// `Err(Overflow)` — it must never panic, and this is the only test
    /// that doesn't reason about where the threshold falls.
    #[test]
    fn quote_never_panics_across_full_i128_domain(
        bps in 0u32..10_000,
        face_value in 1i128..=i128::MAX,
    ) {
        let _ = quote_for(bps, face_value);
    }

    /// `fund_invoice` surfaces the same typed `Overflow` error as `quote`
    /// for an overflowing face value — the guard isn't bypassable through
    /// the funding entry point.
    #[test]
    fn fund_invoice_rejects_overflowing_face_value(
        (bps, threshold) in bps_and_threshold_with_headroom(),
        delta in 1i128..=1_000_000i128,
    ) {
        let face_value = threshold.saturating_add(delta).min(i128::MAX);
        prop_assert_eq!(fund_invoice_for(bps, face_value), Err(Error::Overflow));
    }

    /// `quote`'s advertised advance and the advance `fund_invoice` actually
    /// credits agree, for any non-overflowing face value.
    #[test]
    fn quote_and_fund_invoice_agree(
        bps in 0u32..10_000,
        face_value in 1i128..=SAFE_MAX_FACE_VALUE,
    ) {
        prop_assert_eq!(quote_for(bps, face_value), fund_invoice_for(bps, face_value));
    }

    /// The discount amount alone is also always within `[0, face_value]`
    /// (a cross-check on `discount_amount`'s own subtraction, not just the
    /// sum property above).
    #[test]
    fn discount_amount_is_bounded(
        bps in 0u32..10_000,
        face_value in 1i128..=SAFE_MAX_FACE_VALUE,
    ) {
        let discount = discount_amount_for(bps, face_value).unwrap();
        prop_assert!(discount >= 0);
        prop_assert!(discount <= face_value);
    }
}

// ---- exact, deterministic boundary probes (complement the randomized
// property tests above with the two extremes of the discount_bps range) ----

#[test]
fn threshold_boundary_exact_at_zero_discount() {
    // multiplier = 10_000, threshold = floor(i128::MAX / 10_000).
    let threshold = i128::MAX / 10_000;
    assert!(quote_for(0, threshold).is_ok());
    assert_eq!(quote_for(0, threshold + 1), Err(Error::Overflow));
}

#[test]
fn threshold_boundary_exact_at_max_discount() {
    // discount_bps = 9_999 (the largest value `initialize` accepts) gives
    // multiplier = 1, so the checked multiplication can never overflow for
    // any representable positive `i128` — including `i128::MAX` itself.
    assert_eq!(quote_for(9_999, i128::MAX).unwrap(), i128::MAX / 10_000);
}
