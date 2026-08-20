# Economic Attacks Threat Model - Financing Pool Contract

## Document Status

- **Status:** Economic attack analysis and simulation
- **Scope:** Financing pool contract (Soroban)
- **Date:** 2026-08-20
- **Simulations:** 4 distinct attack vectors with Soroban testutils
- **Critical Issues Found:** 0 (no unmitigated P0/P1 vulnerabilities)
- **Accepted Risks:** 1 (invoice inflation - documented with mitigation strategy)

## Executive Summary

This document analyzes four economic attack vectors specific to the InvoiceFi financing pool contract. Of the four vectors analyzed:

- **3 are fully protected** by contract logic or authorization gates
- **1 is an accepted risk** that requires off-chain mitigation (invoice verification and future oracle integration)
- **0 critical vulnerabilities** remain unmitigated

All simulations confirm that the contract's discount mechanism, liquidity tracking, authorization controls, and oracle freshness checks prevent or mitigate potential economic attacks.

## 1. Attack Vector 1: Flash-Loan-Style Same-Ledger Fund-and-Drain

### Description

This attack simulates multi-operation Stellar transaction sequences where an attacker:
1. Deposits a large amount of liquidity into the pool
2. Immediately uses that liquidity to fund an invoice
3. Attempts to withdraw the original deposit plus the advance in the same ledger

**Attack motivation:** Extract capital from the pool without actual invoice settlement by exploiting atomic transaction properties.

### Technical Details

**Sequence:**
```
Ledger N:
  1. Attacker deposits X tokens → balance[attacker] += X, available += X
  2. Attacker funds invoice Y → available -= advance (where advance < X)
  3. Attacker tries to withdraw X → requires available >= X (FAILS!)
```

**Attack requirements:**
- Liquidity in the pool (satisfied by attacker's own deposit)
- Manager role to fund invoices
- Ability to coordinate operations within single ledger

### Mitigation Analysis

**Protection Mechanism:** Available liquidity tracking

The contract prevents this attack through the following logic:

```rust
pub fn fund_invoice(...) -> Result<i128, Error> {
    // ... authorization and validation ...
    let advance = Self::advance_for(&env, face_value);
    let available = Self::available_inner(&env);
    if available < advance {
        return Err(Error::InsufficientLiquidity);  // First check
    }
    
    Self::set_available(&env, available - advance);  // Reduce available!
    // ... credit recipient ...
}

pub fn withdraw(...) -> Result<(), Error> {
    // ... authorization checks ...
    let available = Self::available_inner(&env);
    if available < amount {
        return Err(Error::InsufficientLiquidity);   // Second check prevents drain
    }
    // ... proceed with withdrawal ...
}
```

**Why the attack fails:**

1. When invoice is funded, `available` is reduced by `advance` amount
2. The attacker's balance is credited with the advance (not the deposit)
3. Withdrawal check ensures `available >= withdraw_amount`
4. If advance < deposit, the attacker cannot withdraw the full original amount

**Numerical Example:**
```
Initial:   available = 0
Deposit:   available = 100,000
Fund:      available = 100,000 - 95,000 = 5,000  (5% discount on 100,000)
Withdraw:  Requires available >= 100,000 → FAILS (only 5,000 available)
```

### Status: **✓ PROTECTED**

**Verdict:** Attack is completely prevented by the available liquidity tracking mechanism. The contract enforces that withdrawn funds cannot exceed un-deployed liquidity.

**Confidence Level:** Very High
- Mechanism is simple and mathematically sound
- Tested with multiple scenarios (see test_flash_loan_fund_and_drain_attack_prevented)
- Protection is enforced before both funding and withdrawal operations

---

## 2. Attack Vector 2: Artificial Invoice Inflation via Collusion

### Description

This attack involves two or more parties (farmer and investor) colluding to:
1. Inflate invoice face values to amounts higher than actual invoice amounts
2. Request pool funding for these artificially inflated invoices
3. Extract excess discount yields from the pool

**Attack motivation:** Extract economic rent from the pool by misrepresenting invoice values.

### Technical Details

**Attack Sequence:**
```
Scenario: Legitimate invoice for 50,000 tokens

Step 1: Investor deposits 500,000 tokens
        available = 500,000

Step 2: Farmer (colluding) creates/claims invoice for 300,000 tokens (fake/inflated)
        - In reality, legitimate invoice amount is 50,000

Step 3: Manager (investor or colluding party) funds the inflated invoice
        advance = 300,000 * 0.95 = 285,000  (5% discount)
        
Step 4: Farmer receives 285,000 tokens (should have received only ~47,500)
        Extracted economic rent = ~237,500 tokens
```

**Attack requirements:**
- Control over invoice creation/data (off-chain)
- Access to liquidity manager role
- Cooperation with invoice recipient (or attacker controls both roles)
- Backend not validating invoice authenticity before funding

### Why This Attack Works

**The Contract Does NOT Validate Invoice Authenticity**

This is a conscious design choice, not an oversight:

```rust
pub fn fund_invoice(
    env: Env,
    caller: Address,
    invoice_id: u64,
    face_value: i128,  // ← Accepted as provided, no validation
    recipient: Address,
) -> Result<i128, Error> {
    // Checks: positive amount, not already funded, fresh oracle, sufficient liquidity
    // NO CHECK: Is this invoice legitimate? Is face_value truthful?
    
    let advance = Self::advance_for(&env, face_value);
    // Funds the advance regardless of invoice authenticity
}
```

The contract **assumes invoice verification happens off-chain** in the backend before this function is called.

### Mitigation Strategy

This attack is an **ACCEPTED RISK** with documented mitigations:

#### 1. **Off-Chain Invoice Verification (Current/Immediate)**

The backend must implement:
- Cryptographic verification of invoice creation/ownership
- Cross-reference with external invoice issuing system
- Validation that face_value matches the actual invoice

```typescript
// Pseudo-code for backend mitigation
async function fundInvoice(invoiceId, facedValue, recipientAddress) {
    // 1. Fetch invoice from authoritative source
    const actualInvoice = await invoiceService.getInvoice(invoiceId);
    
    // 2. Verify face value matches
    if (actualInvoice.amount !== facedValue) {
        throw new Error("Face value mismatch - potential inflation attack");
    }
    
    // 3. Verify recipient authorization
    if (actualInvoice.owner !== recipientAddress) {
        throw new Error("Unauthorized invoice recipient");
    }
    
    // 4. Check invoice hasn't been double-funded
    if (await hasBeenFunded(invoiceId)) {
        throw new Error("Invoice already funded");
    }
    
    // 5. Only then call the contract
    return await pool.fundInvoice(invoiceId, facedValue, recipientAddress);
}
```

#### 2. **Oracle Integration (Future/Long-Term)**

Implement an oracle that attests to invoice legitimacy:

```rust
// Future enhancement - Oracle-backed invoice verification
pub fn fund_invoice_with_attestation(
    env: Env,
    caller: Address,
    invoice_id: u64,
    face_value: i128,
    recipient: Address,
    oracle_attestation: BytesN<64>,  // Signed proof
) -> Result<i128, Error> {
    // Verify oracle signature on (invoice_id, face_value, recipient)
    // This makes invoice inflation cryptographically infeasible
    VerifyOracleSignature::verify(&env, oracle_attestation)?;
    
    // Proceed with funding only if attestation is valid
    Self::fund_invoice(env, caller, invoice_id, face_value, recipient)
}
```

#### 3. **Role Segregation (Current)**

The current implementation uses role-based access control:
- Only `LiquidityManager` role can fund invoices
- Admin can grant/revoke this role
- Reduces attack surface to specific authorized accounts

```rust
AccessControl::require_role(&env, Role::LiquidityManager, &caller)?;
```

### Status: **⚠ ACCEPTED RISK**

**Verdict:** This attack **can succeed** at the contract level, but is **mitigated at the application level** through:
1. Off-chain invoice verification (must be implemented in backend)
2. Restricted LiquidityManager role
3. Future oracle integration (when oracle system is deployed)

**Confidence Level:** Medium
- Attack is real but at protocol boundary, not contract logic
- Effectiveness depends entirely on backend implementation
- Oracle integration would eliminate this risk entirely

**Required Actions:**
- [ ] Document backend invoice verification requirements in operational guide
- [ ] Implement invoice authenticity checks in backend before calling fundInvoice
- [ ] Plan oracle integration for invoice yield attestation
- [ ] Monitor for suspicious funding patterns (many inflated invoices from same parties)

---

## 3. Attack Vector 3: Discount Rate Manipulation Through Liquidity Timing

### Description

This attack attempts to manipulate the discount rate or pool economics by timing operations during low-liquidity periods:

1. Observe periods of low available liquidity in the pool
2. Attempt to fund invoices when conditions are unfavorable
3. Exploit liquidity-dependent calculations to extract better terms

**Attack motivation:** Obtain discounted capital advances at better rates than the fixed pool discount.

### Technical Details

**Attack Hypothesis:**
```
Assume discount rate could vary based on liquidity:
  - High liquidity → high discount (% discount increases)
  - Low liquidity → low discount (% discount decreases)

Attack: Drain liquidity first, then fund invoices at lower discount rates
```

### Why This Attack Cannot Succeed

**The discount rate is FIXED and immutable:**

```rust
pub struct DataKey {
    /// Discount applied on funding, in basis points (1/100th of a percent).
    DiscountBps,
    // ↑ This value NEVER changes after initialization
}

pub fn initialize(
    env: Env,
    signers: Vec<Address>,
    threshold: u32,
    timelock_ledgers: u32,
    discount_bps: u32,  // ← Set once at init, immutable thereafter
) -> Result<(), Error> {
    if discount_bps as i128 >= BPS_DENOMINATOR {
        return Err(Error::InvalidDiscount);
    }
    env.storage().instance().set(&DataKey::DiscountBps, &discount_bps);
    // No function exists to change DiscountBps after this
}

pub fn discount_bps(env: Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::DiscountBps)
        .unwrap_or(0)
    // ↑ Always returns the same value
}
```

The discount calculation is purely deterministic:

```rust
fn advance_for(env: &Env, face_value: i128) -> i128 {
    let bps: u32 = env.storage().instance().get(&DataKey::DiscountBps).unwrap_or(0);
    // bps is always the same
    face_value * (BPS_DENOMINATOR - bps as i128) / BPS_DENOMINATOR
    // Result depends ONLY on face_value and bps, not on liquidity
}
```

**Protection Mechanisms:**

1. **Immutable Discount Rate:** Set once, cannot be changed
2. **No Liquidity-Based Pricing:** Discount is fixed percentage, not dynamic
3. **Availability Checks:** Prevent funding when liquidity insufficient
4. **Authorization Gates:** Only LiquidityManager can fund

### Numerical Proof

```
Fixed discount = 5% (500 BPS)
Formula: advance = face_value * 9500 / 10000

Scenario A: High Liquidity (available = 1,000,000)
  fund_invoice(invoice_id=1, face_value=100,000)
  advance = 100,000 * 9500 / 10000 = 95,000 ✓

Scenario B: Low Liquidity (available = 5,000)
  fund_invoice(invoice_id=2, face_value=100,000)
  advance = 100,000 * 9500 / 10000 = 95,000 ✓
  
  But: available < advance (5,000 < 95,000)
  Result: Error::InsufficientLiquidity (funding blocked)
  NOT Error with different discount!
```

### Status: **✓ PROTECTED**

**Verdict:** Attack is completely impossible. The discount rate is mathematically fixed at initialization and cannot be varied based on any runtime condition, including liquidity.

**Confidence Level:** Very High
- No mutation function exists for DiscountBps
- Discount calculation is stateless and deterministic
- Liquidity checks prevent over-funding, but don't change discount rates
- Verified through code inspection and mathematical proof

---

## 4. Attack Vector 4: Oracle Staleness Exploitation

### Description

This attack attempts to exploit the oracle price feed by:
1. Waiting for the oracle price feed to become stale
2. Funding invoices when the oracle has not been updated recently
3. Potentially exploiting stale data or bypassing intended oracle verification

**Attack motivation:** Bypass oracle freshness requirements to fund under false or outdated conditions.

### Technical Details

**Oracle Freshness Check:**

```rust
pub const MAX_PRICE_AGE_LEDGERS: u32 = 100;

fn require_fresh_price_feed(env: &Env) -> Result<(), Error> {
    let current_ledger: u32 = env.ledger().sequence();
    let feed: Option<(i128, u32)> = env.storage().instance().get(&DataKey::PriceFeed);
    match feed {
        Some((_price, timestamp)) => {
            let age = current_ledger.saturating_sub(timestamp);
            if age > MAX_PRICE_AGE_LEDGERS {  // ← Staleness check
                return Err(Error::StalePriceFeed);
            }
            Ok(())
        }
        None => Err(Error::StalePriceFeed)  // No data = stale
    }
}

pub fn fund_invoice(...) -> Result<i128, Error> {
    // ... other checks ...
    Self::require_fresh_price_feed(&env)?;  // ← MANDATORY check before funding
    // ... funding proceeds only if oracle is fresh ...
}
```

**Attack Scenario:**
```
Current ledger: 1000
Oracle timestamp: 950
Age: 1000 - 950 = 50 (< 100) → Fresh, funding allowed

Later:
Current ledger: 1050
Oracle timestamp: still 950 (not updated)
Age: 1050 - 950 = 100 (>= 100) → Stale, funding REJECTED

Attacker tries to fund: Error::StalePriceFeed
```

### Why This Attack Cannot Succeed

**The staleness check is mandatory and enforced in every fund_invoice call:**

1. **Mandatory Check:** Cannot be bypassed or skipped
2. **Early Return:** Function fails immediately if check fails
3. **No Alternative Path:** No way to fund without fresh oracle
4. **Zero Configuration:** MAX_PRICE_AGE_LEDGERS is a constant, immutable

The control flow is:

```
fund_invoice() called
  ↓
require_fresh_price_feed() ← Checked FIRST, before any state changes
  ↓
[IF STALE]
  return Error::StalePriceFeed ← Function exits, no funding occurs
  ↓
[IF FRESH]
  Proceed with funding
```

### Oracle as Protocol Boundary

The oracle freshness check represents an important protocol boundary:

**Current Status:**
- Oracle price feed is stored by contract admin/backend
- The contract validates freshness but **does not verify authenticity**
- No signature verification on oracle data

**Implications:**
- Prevents trivial timestamp manipulation (cannot fund with old timestamp)
- Does NOT prevent admin from posting false data at recent timestamp
- Requires trusted admin/oracle provider

**Future Enhancements (Out of Scope):**
- Sign oracle updates cryptographically
- Use decentralized oracle (e.g., Stellar's on-chain oracle service, if available)
- Require consensus among multiple oracle providers

### Status: **✓ PROTECTED**

**Verdict:** Staleness-based attacks are completely prevented. No funding can occur without a fresh oracle timestamp.

**Confidence Level:** Very High
- Staleness check is mathematically sound
- Timing attacks cannot bypass the check
- Ledger sequence is monotonically increasing and cannot be manipulated
- No configuration or authorization can disable the check

**Note on Oracle Authenticity:**
- Staleness check is about **recency**, not **authenticity**
- Current implementation does NOT verify cryptographic signatures on oracle data
- This is an accepted design choice (oracle provider is trusted)
- If oracle provider is compromised, false data at recent timestamps would not be detected
- Recommendation: Plan for authenticated oracle feeds in future version

---

## 5. Stellar Network-Level MEV - Out of Scope

### Why Network-Level MEV is Out of Scope

This threat model explicitly excludes Stellar network-level Miner Extractable Value (MEV) / Validator Extractable Value (VEV):

**Reasons:**

1. **Not a contract vulnerability:** MEV is a property of the underlying blockchain, not the contract code
2. **Stellar-specific:** Stellar's transaction model differs from Ethereum (no public mempool, consensus-based ordering)
3. **Blockchain upgrade needed, not contract change:** Mitigation requires network-level changes
4. **Outside protocol control:** Contract cannot prevent validator-level extraction

**Theoretical Stellar MEV Scenarios (Documented but Unaddressed):**

- Validator reordering multiple transactions in a single ledger
- Validator censoring transactions to exploit market conditions
- Validator front-running/back-running invoice funding operations

**Why InvoiceFi is Less Vulnerable to MEV than DeFi:**

- No asset price-based liquidations (MEV's primary target)
- Invoices are business documents, not financial positions
- Discount rates are fixed, not dynamic (no slippage to extract)
- No flash-loan-compatible composability at smart contract level

**Mitigation Strategy (If Needed):**
- Advocate for Stellar protocol improvements (encrypted mempools, threshold encryption)
- If available, use Stellar's official oracle system for timestamp randomization
- Require timelock delays for sensitive operations (already implemented via AccessControl)

---

## 6. Threat Matrix Summary

| Attack Vector | Description | Type | Status | Likelihood | Impact | Overall Risk |
|---|---|---|---|---|---|---|
| Flash-Loan Fund-and-Drain | Same-ledger deposit-fund-withdraw | Economic | Protected | Low | Medium | Low |
| Artificial Invoice Inflation | Colluding parties inflate face values | Governance | Accepted Risk* | Medium | High | Medium* |
| Discount Rate Timing | Exploit liquidity changes for better rates | Economic | Protected | Very Low | Low | Very Low |
| Oracle Staleness | Fund with stale price data | Oracle | Protected | Very Low | High | Very Low |
| Network-Level MEV | Validator reordering/censoring | Network | N/A | N/A | N/A | Out of Scope |

*Accepted Risk: Mitigated by required off-chain controls and future oracle integration

---

## 7. Recommendations and Next Steps

### Immediate Actions (Before Production)

- [ ] **Invoice Verification:** Implement backend invoice authenticity validation before calling `fund_invoice`
- [ ] **Audit Oracle Provider:** Verify the entity providing oracle price updates is trustworthy and has secure operations
- [ ] **Monitor Liquidity:** Set up alerts for unusual pool liquidity patterns (potential sign of collusion)
- [ ] **Role Audit:** Regularly audit who holds `LiquidityManager` role

### Short-Term (1-2 months)

- [ ] **Operational Runbook:** Document expected oracle update frequency and failure procedures
- [ ] **Circuit Breaker:** Implement off-chain circuit breaker to pause funding if oracle updates are delayed
- [ ] **Logging:** Add comprehensive logging for all funding operations and invoice data mismatches
- [ ] **Fee Mechanism:** Consider implementing protocol fees that increase during high-collusion-risk scenarios

### Long-Term (3+ months)

- [ ] **Cryptographic Oracle Signatures:** Implement oracle attestation signatures on invoice data
- [ ] **Decentralized Oracle:** Integrate with Stellar's official oracle system (if available)
- [ ] **Oracle Consensus:** Require attestation from multiple independent oracle providers
- [ ] **Dynamic Discount Governance:** If discount rates need adjustment, implement 2-of-3 admin multisig + timelock

### Testing and Monitoring

- [x] **Simulated Economic Attacks:** See `contracts/financing-pool/src/economic_attacks_tests.rs`
- [ ] **Load Testing:** Simulate high-volume simultaneous deposits/funding/withdrawals
- [ ] **Chaos Testing:** Simulate oracle outages, delayed updates, network partitions
- [ ] **Forensic Analysis:** Post-incident review of any actual collusion attempts

---

## 8. Conclusion

The InvoiceFi financing pool contract demonstrates strong economic security properties for attacks that occur at the contract level. The three primary economic attack vectors (flash-loans, discount manipulation, oracle staleness) are all effectively prevented through deterministic discount rates, liquidity tracking, and mandatory oracle freshness checks.

The one accepted risk (artificial invoice inflation) exists at the application boundary (off-chain invoice data) rather than contract logic. This risk is mitigated through required off-chain controls and can be eliminated entirely through oracle integration.

**Overall Assessment:** The financing pool contract is economically sound and ready for audited deployment, provided that:
1. Off-chain invoice verification is implemented
2. Oracle provider is trusted and monitored
3. Operational procedures include circuit breakers for oracle failures

**Recommendation:** Proceed with deployment for beta testing, with full production deployment after:
- Third-party security audit (contract + operational procedures)
- Oracle provider audit and SLA agreement
- 3-month operational history from beta deployment

---

## 9. Appendix: Simulation Test Results

All economic attack scenarios have been simulated using Soroban testutils. The test file `contracts/financing-pool/src/economic_attacks_tests.rs` contains:

1. `test_flash_loan_fund_and_drain_attack_prevented()` - Verifies flash-loan attack is prevented
2. `test_artificial_invoice_inflation_collusion_accepted_risk()` - Demonstrates accepted risk and required mitigations
3. `test_discount_rate_timing_attack_prevented()` - Proves fixed discount rate
4. `test_oracle_staleness_attack_prevented()` - Confirms oracle staleness protection
5. `test_economic_attacks_summary()` - Index of all attacks and status

**Test Execution:**
```bash
cd contracts/financing-pool
cargo test --test economic_attacks_tests
```

**Expected Output:** All 5 tests pass, with detailed status output describing each attack vector.

---

**Document Version:** 1.0  
**Last Updated:** 2026-08-20  
**Next Review:** After beta deployment (3 months) or after first security audit
