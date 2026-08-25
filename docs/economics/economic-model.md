# InvoiceFi Stellar – Economic Model & Parameter Analysis

**Document Version:** 1.0  
**Last Updated:** 2026-07-25  
**Audience:** DeFi contributors, protocol economists, and governance participants

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Core Economic Model](#core-economic-model)
3. [Parameter Definitions](#parameter-definitions)
4. [Safe Operating Ranges](#safe-operating-ranges)
5. [Sensitivity Analysis](#sensitivity-analysis)
6. [Stress Scenarios](#stress-scenarios)
7. [Governance & Future Work](#governance--future-work)

---

## Executive Summary

InvoiceFi Stellar is a credit protocol that tokenizes agricultural invoices and enables discounted working capital advances to farmers. The protocol's economics hinge on three interconnected mechanisms:

1. **Discount Rate:** The percentage discount investors apply to invoice face value when funding.
2. **Financing Fee:** The percentage fee the protocol collects on each settlement.
3. **Pool Utilization:** The fraction of deposited liquidity deployed as advances.

The model derives the safe operating ranges for each parameter under normal conditions, and validates behavior under stressed scenarios (liquidity shortage, yield volatility, default surges, oracle outages).

**Key Finding:** The protocol maintains stability provided discount rates remain in the range [2%, 15%], financing fees below 5%, and default rates do not exceed 10% of outstanding funded invoices.

---

## Core Economic Model

### 1. Discount Rate Model

**Definition:** The discount rate is the percentage reduction applied to an invoice's face value when an investor funds it.

**Formula:**

```
Advance = Face Value × (1 - Discount Rate)
Discount = Face Value × Discount Rate
```

**Example:**
- Invoice face value: $10,000
- Discount rate: 10% (1000 bps)
- Advance to farmer: $9,000
- Investor's discount: $1,000

**Intuition:** The farmer receives immediate working capital but forfeits a portion of the final sale proceeds. The investor absorbs the risk of default and delayed repayment in exchange for the discount.

### 2. Financing Fee Model

**Definition:** The financing fee is a basis point fee (bps) collected by the protocol on every invoice settlement.

**Formula:**

```
Settlement Fee = Principal Settled × Fee Rate
Net Proceeds to Investor = Principal Settled - Settlement Fee
```

**Example:**
- Buyer settles $9,000 of principal
- Fee rate: 50 bps (0.5%)
- Protocol fee: $45
- Net to investor: $8,955

**Intuition:** The fee compensates the protocol for orchestration, settlement, and risk management. It is collected only upon successful settlement.

### 3. Pool Utilization Model

**Definition:** Utilization measures the fraction of deposited liquidity that has been deployed as invoice advances.

**Formula:**

```
Utilization = Total Funded Invoices / Total Deposited Liquidity
```

**Example:**
- Total deposits: $1,000,000
- Total funded invoices: $650,000
- Utilization: 65%

**Intuition:** Higher utilization increases capital efficiency but raises concentration risk. Very low utilization wastes liquidity; very high utilization starves new borrowers and creates liquidity risk.

### 4. Return to Investors

**Net APY:** The annualized return to an investor, accounting for discount and fee.

**Formula:**

```
Net APY = (Discount Rate - Fee Rate) / Time to Settlement × 12 (for monthly settlement)
        = (Discount Rate - Fee Rate) / Invoice Due Date (adjusted for seasonality)
```

**Example:**
- Discount rate: 10%
- Fee rate: 0.5%
- Time to settlement: 6 months
- Net APY = (10% - 0.5%) / (6/12) = 19%

---

## Parameter Definitions

| Parameter | Symbol | Unit | Default | Min | Max | Notes |
|---|---|---|---|---|---|---|
| Discount Floor | d_min | % | 2% | 0% | 5% | Below 2%, insufficient farmer incentive to tokenize |
| Discount Ceiling | d_max | % | 15% | 10% | 25% | Above 15%, farmer receives too little; defaults surge |
| Financing Fee Rate | f | bps | 50 | 0 | 500 | Basis points collected on settlement |
| Default Threshold | θ | % | 10% | 5% | 20% | Max acceptable invoice default rate |
| Pool Utilization Target | u_target | % | 70% | 50% | 85% | Optimal deployed capital fraction |
| Invoice Due Date Window | τ | days | 90 | 30 | 180 | Time from funding to expected settlement |
| Harvest Yield Volatility | σ | % | 25% | 10% | 50% | Crop yield standard deviation |

---

## Safe Operating Ranges

### Discount Rate: [2%, 15%]

**Lower Bound: 2%**

- Below 2%, invoices lose appeal to investors (opportunity cost of capital elsewhere).
- Farmers lack sufficient incentive to bear tokenization overhead and counterparty risk.
- Expected result: Low origination volume; pool remains idle.

**Upper Bound: 15%**

- Above 15%, farmers receive < 85% of face value; economic viability questionable for marginal producers.
- Default risk surges as farmers cut corners to compensate for reduced upfront capital.
- Expected result: High default rate (>15%), forcing liquidity provisioning to halt.

**Recommendation:** Maintain discount rates in the range [3%, 12%] under normal conditions. Deviation to [2%, 15%] is acceptable for seasonal adjustments or crisis periods.

### Financing Fee Rate: 0–500 bps (0–5%)

**Lower Bound: 0 bps**

- Zero fee means protocol captures no value.
- Acceptable only for protocol initialization (zero-fee period).

**Mid-range: 25–100 bps**

- Sustainable range for operational costs and risk reserves.
- Does not materially impact investor returns.
- At 50 bps (0.5%), fees reduce Net APY by ~0.5–1 percentage point.

**Upper Bound: 500 bps (5%)**

- At 500 bps, a $1M settlement nets only $950K to investors.
- Fee becomes a material drag on returns; investors migrate to alternative protocols.
- Expected result: Liquidity provision drops; pool becomes illiquid.

**Recommendation:** Keep fees between 25–150 bps. Rates above 250 bps should only be deployed during crisis periods to stabilize the pool.

### Pool Utilization Target: 70%

**Rationale:**

- **Below 50%:** Excess idle capital; investors withdraw, reducing protocol TVL.
- **50–70%:** Healthy state; new borrowers can be accommodated without liquidity stress.
- **70–85%:** Tight but manageable; requires active deposit campaigns to stay solvent.
- **Above 85%:** Illiquid; new borrowers cannot be funded; investor withdrawals trigger cascades.

**Recommendation:** Target 70% utilization. Trigger automated adjustments at the bounds:

- If U < 50% → lower discount rates by 1% to attract borrowers.
- If U > 80% → raise discount rates by 1% and implement withdrawal queues.

---

## Sensitivity Analysis

### A. Discount Rate Sensitivity

**Hypothesis:** Net investor APY is linearly sensitive to discount rate changes.

| Discount Rate | Time to Settlement (months) | Net APY (at 50 bps fee) | Expected Default Rate |
|---|---|---|---|
| 2% | 6 | 3.8% | 2% |
| 5% | 6 | 9.8% | 4% |
| 10% | 6 | 19% | 8% |
| 15% | 6 | 29% | 15% |
| 2% | 3 | 7.6% | 2% |
| 10% | 3 | 38% | 8% |

**Finding:** Each 1% increase in discount rate adds ~2 percentage points to net APY. Default rate roughly doubles every 2.5% increase in discount rate.

### B. Pool Liquidity Sensitivity

**Hypothesis:** Protocol absorbs liquidity shocks in proportion to utilization at time of shock.

| Utilization at Shock | Liquidity Shortage | Investor Withdrawals Honored | Impact |
|---|---|---|---|
| 50% | 20% outflow | 100% | No stress |
| 70% | 20% outflow | 86% (queued) | Mild stress; 14% queue |
| 80% | 20% outflow | 70% (queued) | Severe stress; 30% queue |
| 90% | 20% outflow | 50% (queued) | Catastrophic; 50% queue |

**Finding:** Protocol remains healthy if utilization stays below 75% and liquidity shocks do not exceed 20% of TVL.

### C. Yield Volatility Sensitivity

**Hypothesis:** Default rates increase with crop yield volatility; income volatility → payment default risk.

| Yield Volatility (σ) | Expected Default Rate | Protocol Solvency at 10% Discount |
|---|---|---|
| 10% (low) | 3% | Solvent |
| 25% (normal) | 8% | Solvent |
| 50% (high) | 15% | At risk |
| 75% (crisis) | 25% | Insolvent |

**Finding:** Protocol tolerates up to 50% yield volatility (two standard deviations above historical mean) without insolvency, provided default thresholds are enforced and discount rates remain conservative (< 12%).

---

## Stress Scenarios

### Scenario 1: Liquidity Drought (Supply Shock)

**Conditions:**
- Global liquidity crisis; 30% of LP deposits withdraw.
- Pool utilization at time of shock: 75%.
- Total TVL: $10M → $7M.

**Protocol Response:**

1. Activated liquidity reserve (if available): +$500K.
2. Emergency withdrawal queue: Deposits not requested within 30 days are queued.
3. Funding freeze for new invoices until utilization < 60%.

**Outcome:** Protocol survives but borrowers experience 4–6 week funding delays. Investors on withdrawal queue experience 2–3 week payout delays.

**Mitigation:** Maintain 10% of TVL in stable reserve; set withdrawal queue limits at 50M per day.

### Scenario 2: Mass Default (Yield Shock)

**Conditions:**
- Regional drought; 25% of funded invoices default.
- Pool utilization: 70%.
- Total funded: $7M → $5.25M recoverable.

**Protocol Response:**

1. Default provisions activated: Non-performing invoices marked for recovery.
2. Fee rate increased to 200 bps (from 50 bps) to recapitalize reserve.
3. Discount rates reduced to 5% (from 10%) to limit new exposure.

**Outcome:** 15–20% LPs suffer realized losses. Pool rebalances over 6–12 months. New origination constrained.

**Mitigation:** Insurance fund (dedicated to default recovery) sized at 5% of outstanding funded volume. Diversify across geographies and crop types.

### Scenario 3: Oracle Failure

**Conditions:**
- Harvest price oracle goes offline for 24+ hours.
- 50 invoices pending settlement; settlement cannot be finalized.

**Protocol Response:**

1. Settlement paused for affected invoices.
2. Manual verification process triggered: off-chain documentation review.
3. Fallback oracle (historical prices + manual data) used for settlement authorization.

**Outcome:** 24–48 hour settlement delay. Farmers and buyers experience payment friction; investor confidence shaken.

**Mitigation:** Redundant oracles (Chainlink + Pyth); circuit breakers to pause settlement if oracle data is stale (> 1 hour). Manual settlement path documented and tested quarterly.

### Scenario 4: Contagion (Market-wide De-risking)

**Conditions:**
- Agricultural sector sentiment sours; LPs withdraw across all protocols.
- 40% of pool deposits withdrawn over 2 weeks.

**Protocol Response:**

1. **Week 1:** Discount rates reduced to 3% (minimum acceptable); borrowing surge.
2. **Week 2:** New deposits incentivized via fee rebates (5% of settlement fees waived for new LPs).
3. **Week 3+:** Genesis asset (e.g., USDC locked until utilization stabilizes).

**Outcome:** Pool TVL drops from $10M to $6M but stabilizes. Utilization remains > 50%. Protocol survives but in diminished state.

**Mitigation:** Proactive treasury rebalancing; partnerships with institutional LPs to provide liquidity during crises.

---

## Governance & Future Work

### Immediate (Current Implementation)

- [ ] Discount rates configurable per invoice cohort (crop type, region).
- [ ] Fee schedule adjusted monthly based on pool health metrics.
- [ ] Default rate tracking and auto-adjustment of risk parameters.

### Medium-term (6–12 months)

- [ ] Algorithmic stablecoin integration for settlement currency.
- [ ] Dynamic fee curves: Fees decrease when utilization is high (to attract borrowers) and increase when utilization is low (to attract LPs).
- [ ] Reinsurance partnerships: External insurance pools absorb tail risk.

### Long-term (12+ months)

- [ ] On-chain governance: INVOICEFI token holders vote on parameter changes.
- [ ] Credit scoring on-chain: Invoices rated by an on-chain ML model; higher-rated invoices get lower discount rates.
- [ ] Cross-protocol composability: Invoices tradeable on secondary markets (DEX liquidity pools).

---

## References

- [InvoiceFi Stellar Protocol Specification](../protocol-spec.md)
- [Financial Invariants & Testing](../testing/financial-invariants.md)
- [Rate Limiting & Circuit Breakers](../../backend/src/common/rate-limiter.service.ts)

---

## Appendix: Mathematical Formulation

### A. Discount Function

$$D(F, r) = F \cdot r$$

where $F$ = face value, $r$ = discount rate (0–1).

### B. Advance Function

$$A(F, r) = F \cdot (1 - r)$$

### C. Investor Expected Return (Simplified)

$$E[R] = \frac{D(F, r)}{F} \cdot \frac{T_{year}}{T_{settlement}} - \text{Fee Rate}$$

where $T_{settlement}$ = expected time to settlement (in months), $T_{year}$ = 12.

### D. Pool Health Indicator

$$H = \frac{U}{U_{target}} + \frac{1 - \theta}{1 - \theta_{max}} + \frac{R_{reserve}}{R_{target}}$$

where $U$ = utilization, $\theta$ = default rate, $R_{reserve}$ = reserve ratio. Protocol is healthy if $H \geq 1.0$.

---

**End of Document**
