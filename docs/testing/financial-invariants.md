# Financial Calculation Invariants

This document formalizes the mathematical invariants that must hold for all financial calculations in the InvoiceFi Stellar protocol.

## Overview

Financial calculations are the bedrock of the protocol's trustworthiness. All calculations are tested with property-based tests using `fast-check`, generating 10,000 random examples per invariant to catch edge cases and boundary violations.

## Invariants

### 1. Discount Monotonicity

**Statement:** For a fixed face value, a higher discount rate always yields a higher absolute discount amount.

**Formula:** `faceValue ≥ 0, 0 ≤ rate₁ ≤ rate₂ ≤ 10000 ⟹ discount(faceValue, rate₁) ≤ discount(faceValue, rate₂)`

**Why it matters:** Investors and farmers must have predictable pricing. A higher discount rate should never reduce the discount—it must increase monotonically.

**Test:** Generates random face values (0–1M) and pairs of discount rates, verifying the monotonic relationship.

---

### 2. Discount and Advance Sum to Face Value

**Statement:** The discount plus the advance amount must always equal the face value (conservation of value).

**Formula:** `discount(faceValue, rate) + advance(faceValue, rate) = faceValue`

**Why it matters:** This is the fundamental accounting identity. Every dollar in the invoice must account for either the investor's discount or the farmer's advance.

**Test:** Verifies that for all valid inputs, the sum equals the face value exactly.

---

### 3. Advance Never Exceeds Face Value

**Statement:** The advance amount to the farmer is always less than or equal to the face value.

**Formula:** `0 ≤ advance(faceValue, rate) ≤ faceValue`

**Why it matters:** It is impossible for a farmer to borrow more than the invoice face value. The advance is a discounted subset of the invoice.

**Test:** Validates bounds for all face values and discount rates.

---

### 4. Fee Calculation Monotonicity

**Statement:** For a fixed fee rate, a higher amount yields a higher absolute fee.

**Formula:** `amount₁ ≤ amount₂, rate ≥ 0 ⟹ fee(amount₁, rate) ≤ fee(amount₂, rate)`

**Why it matters:** Fee structures must be predictable. Larger settlements should never result in lower fees.

**Test:** Generates pairs of amounts and verifies the monotonic relationship.

---

### 5. Pool Utilization Bounded [0, 100]

**Statement:** Pool utilization (funded / deposited) is always between 0% and 100%.

**Formula:** `0 ≤ utilization(funded, deposited) ≤ 100`

**Why it matters:** Utilization is a percentage; it cannot be negative or exceed 100%. An invariant violation indicates a data integrity issue.

**Test:** Validates bounds for all combinations of funded and deposited amounts.

---

### 6. Pool Utilization Increases with More Funding

**Statement:** For a fixed pool of deposited liquidity, funding more invoices increases (or keeps constant) utilization.

**Formula:** `funded₁ ≤ funded₂ ≤ deposited ⟹ utilization(funded₁, deposited) ≤ utilization(funded₂, deposited)`

**Why it matters:** Utilization should move monotonically as the pool deploys capital. An inversion would indicate a bug in the funding logic.

**Test:** Generates base funding amounts and incremental deltas, verifying the monotonic relationship.

---

### 7. Repayment Schedule Amount Non-Negative

**Statement:** The calculated payment amount for each period is always non-negative.

**Formula:** `principal ≥ 0, payments ≥ 1, rate ≥ 0 ⟹ repayment(principal, payments, rate) ≥ 0`

**Why it matters:** A negative payment would mean the farmer owes the buyer money, not the other way around. This would violate the protocol semantics.

**Test:** Validates for all valid principal, payment count, and interest rate combinations.

---

### 8. Total Repayment ≥ Principal

**Statement:** The total amount repaid (sum of all payments) is always greater than or equal to the principal due to interest.

**Formula:** `totalRepayment(principal, payments, rate) ≥ principal`

**Why it matters:** Interest is the cost of borrowing. Total repayment must exceed the principal (or equal it if rate = 0).

**Test:** Verifies for all valid inputs, especially boundary cases (rate = 0).

---

### 9. Discount Rate Idempotency

**Statement:** Applying the discount calculation multiple times to the same inputs yields the same result.

**Formula:** `discount(faceValue, rate) = discount(faceValue, rate)` (always)

**Why it matters:** Discount calculation must be deterministic and free of side effects. A violation would indicate non-determinism or floating-point precision bugs.

**Test:** Calls the function twice and verifies the results are identical.

---

### 10. Fee Is Non-Negative

**Statement:** The calculated fee is always non-negative.

**Formula:** `amount ≥ 0, rate ≥ 0 ⟹ fee(amount, rate) ≥ 0`

**Why it matters:** A negative fee would mean the protocol is paying the settlement party, not collecting a fee. This violates the protocol's revenue model.

**Test:** Validates for all valid amounts and rates.

---

### 11. Advance Increases as Discount Decreases

**Statement:** A lower discount rate yields a higher advance amount (inverse relationship).

**Formula:** `rate₁ ≤ rate₂ ⟹ advance(faceValue, rate₁) ≥ advance(faceValue, rate₂)`

**Why it matters:** Investors and farmers trade off. A smaller discount (lower investor return) means a larger advance (more capital to the farmer). This inverse relationship is fundamental to the protocol's economics.

**Test:** Generates pairs of discount rates and verifies the inverse monotonic relationship.

---

### 12. Zero Discount Rate Yields Full Advance

**Statement:** A discount rate of 0 basis points means the farmer receives the full face value.

**Formula:** `advance(faceValue, 0) = faceValue`

**Why it matters:** At 0% discount, there is no investor discount; the farmer gets 100% of the invoice value. This is the upper bound on farmer proceeds.

**Test:** Validates for all face values.

---

### 13. Maximum Discount Rate Boundary

**Statement:** The maximum discount rate (9999 bps ≈ 99.99%) yields a valid discount less than the face value.

**Formula:** `0 ≤ discount(faceValue, 9999) < faceValue`

**Why it matters:** Discount rates are bounded by 10000 bps (100%) in the contract. At 9999 bps, the discount is just under the full face value, leaving the farmer a nominal advance. A violation indicates an off-by-one error or overflow.

**Test:** Validates the boundary case at the maximum allowed discount rate.

---

### 14. Conservation of Value in Repayment

**Statement:** The sum of individual payment amounts equals the total repayment amount (no rounding losses exceed 1 cent).

**Formula:** `Σ repayment(principal, 1, rate) ≈ totalRepayment(principal, payments, rate)`

**Why it matters:** Rounding errors in amortization schedules can create unintended losses or surpluses across a portfolio of invoices. This invariant bounds rounding to < $0.01 per schedule.

**Test:** Calculates per-period payment, sums over all periods, and compares to the total.

---

### 15. Fee Does Not Exceed Amount

**Statement:** The calculated fee is always less than or equal to the original amount.

**Formula:** `fee(amount, rate) ≤ amount`

**Why it matters:** A fee of 10% on $100 cannot be $150. The fee rate produces a fee bounded by the amount itself.

**Test:** Validates for all amounts and rates up to 10000 bps.

---

## Test Configuration

- **Framework:** Jest with fast-check property testing
- **Examples per invariant:** 10,000 generated cases
- **Test file:** `backend/src/common/financial-calculations.property.spec.ts`
- **Expected runtime:** < 30 seconds for all 15 invariants
- **Failure behavior:** On any counterexample, the test logs the failing input and stops

## Running the Tests

```bash
cd backend
npm test -- financial-calculations.property.spec.ts
```

## Adding New Invariants

When adding a new financial calculation:

1. State the invariant formally (using the template above).
2. Implement a property test with at least 10,000 examples.
3. Document the "Why it matters" rationale.
4. Add a regression fixture for any counterexample found during development.
5. Update this document.

---

## References

- **Basis Points (bps):** 1 bps = 0.01%. 10000 bps = 100%. Used throughout for fixed-point precision.
- **Rounding:** All monetary amounts are rounded to the nearest cent (2 decimal places).
- **Property Testing:** [fast-check documentation](https://github.com/dubzzz/fast-check)
- **Protocol Spec:** See `docs/protocol-spec.md` for the full invoice lifecycle and economic model.
