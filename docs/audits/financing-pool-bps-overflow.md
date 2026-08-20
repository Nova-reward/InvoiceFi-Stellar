# Financing Pool BPS Overflow Audit

**Scope:** `contracts/financing-pool/src/lib.rs` (`advance_for`, `quote`, `discount_amount`, `fund_invoice`), `contracts/settlement/src/lib.rs` (`settle_invoice` fee calculation, `set_fee_rate`)
**Focus:** i128 overflow in basis-point (BPS) discount/fee multiplication
**Related issue:** #154

---

## Executive Summary

**Finding:** confirmed, exploitable in principle, fixed.

Both the financing pool's advance calculation and the settlement contract's
fee calculation compute `value * bps_factor` in `i128` *before* dividing by
`10_000`. For a `face_value`/`amount` large enough, that intermediate
multiplication overflows `i128` before the division ever brings it back
into range — even though the final, correctly-rounded result would fit
comfortably. Neither site guarded against this.

In `financing-pool`, `overflow-checks = true` is set for the `release`
profile (see `contracts/Cargo.toml`), so on a real deployment this would
currently **panic and abort the transaction** rather than silently wrap —
not a fund-draining bug, but an unguarded host trap with no typed error,
and undefined behavior if that profile setting were ever dropped. In
`settlement`, the same class of overflow existed in `settle_invoice`'s fee
computation. Additionally, `set_fee_rate` had no upper bound at all: a
`fee_rate` at or above `10_000` (100%) would make `settle_invoice`'s
`net = amount - fee` go negative, silently under-crediting the borrower's
principal.

**Risk level:** Low likelihood (requires a `face_value`/`amount` far beyond
any realistic invoice, and/or an admin misconfiguring `fee_rate`), but the
failure mode (an unguarded panic, or a silently negative net) is exactly
the kind of thing a typed error should catch instead. Fixed by adding
`checked_mul` guards that return typed errors, plus an explicit bound on
`set_fee_rate`.

---

## The multiplication

```rust
// financing-pool: advance_for
face_value * (BPS_DENOMINATOR - bps as i128) / BPS_DENOMINATOR

// settlement: settle_invoice fee calculation
(amount * fee_rate as i128) / 10000
```

`BPS_DENOMINATOR` is `10_000`. In both cases the multiplier (`10_000 -
discount_bps`, or `fee_rate`) is bounded — `discount_bps` is checked
`< 10_000` at `initialize`, so the financing-pool multiplier is always in
`[1, 10_000]`. `fee_rate`, before this fix, had **no** upper bound at all
on the settlement side.

For any multiplier `m` in that range, the multiplication `value * m`
overflows `i128::MAX` (`170141183460469231731687303715884105727`) once
`value > i128::MAX / m`. At `m = 10_000` (the worst case for
`financing-pool`, `discount_bps = 0`) that threshold is
`i128::MAX / 10_000 ≈ 1.7 × 10^34` — an astronomically large face value
that no real invoice would ever carry, but one an unvalidated caller
(or a future contract bug feeding in a corrupted value) could still
submit as a plain `i128` argument. Soroban has no smaller machine integer
between `i64` and `i128` to fall back on for validation, so the guard has
to live in the arithmetic itself.

## Fix

**`financing-pool::advance_for`** now uses `checked_mul` and returns
`Result<i128, Error>`, with a new `Error::Overflow` variant. `fund_invoice`,
`quote`, and `discount_amount` propagate it with `?` instead of silently
computing an overflowing value.

**`settlement::settle_invoice`**'s fee calculation now uses `checked_mul`
too, returning the new `SettlementError::FeeCalculationOverflow` via
`panic_with_error!` (consistent with how every other guard in this
function reports failure — this function returns `()`, not `Result`, so
there's no `Result`-based path available here the way there is in
`financing-pool`).

**`settlement::set_fee_rate`** now rejects `fee_rate > 10_000` with
`SettlementError::InvalidFeeRate`, closing the negative-`net` case at
configuration time rather than relying on the overflow guard (which
wouldn't even fire for a too-high-but-non-overflowing `fee_rate`) to catch
it downstream.

Neither fix changes behavior for any `face_value`/`amount` in the range any
real invoice would use — the `checked_mul` result is bit-for-bit identical
to the unchecked multiplication whenever the unchecked version wouldn't
have overflowed.

## Test coverage

`contracts/financing-pool/src/bps_overflow_proptest.rs` adds 11
`proptest`-driven property tests plus 2 deterministic boundary tests,
exercised through the real public API (`initialize` → `quote` /
`fund_invoice`, not by calling the private `advance_for` directly), covering:

- the advance is always in `[0, face_value]` and never negative
- `discount_amount + advance == face_value` (nothing lost or invented)
- `discount_bps = 0` returns the face value exactly
- monotonicity of the advance in both `face_value` and `discount_bps`
- every face value at or below the exact per-discount overflow threshold
  (`floor(i128::MAX / multiplier)`) succeeds
- every face value strictly above that threshold is rejected with
  `Error::Overflow`, both through `quote` and through `fund_invoice`
  directly (the guard isn't bypassable through the funding entry point)
- a fuzz-style sweep across the full `i128` domain that only asserts
  "never panics" (`Ok` or `Err(Overflow)`, nothing else)
- `quote` and `fund_invoice` agree on the credited advance
- the two extremes of `discount_bps` (`0` and `9_999`, the largest value
  `initialize` accepts) probed exactly: `discount_bps = 9_999` gives a
  multiplier of `1`, which — as a cross-check on the property tests above —
  can be shown to never overflow for any representable `i128`.

`cargo test --all` passes (139 pre-existing tests + the new proptest
suite), and this audit note itself was written after confirming both fixes
against that suite.
