# Oracle Aggregator Architecture

## Overview

The Oracle Aggregator is a Soroban smart contract that aggregates price data from multiple independent off-chain submitters to provide reliable, tamper-resistant price feeds for the InvoiceFi protocol. It addresses the critical need for on-chain price references in discount calculations.

## Design Goals

1. **Decentralization**: No single point of failure or manipulation
2. **Accuracy**: Median aggregation with outlier rejection
3. **Freshness**: Configurable staleness checks
4. **Flexibility**: Per-asset-pair configuration
5. **Security**: Authorized submitter whitelist

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Off-Chain Submitters                       │
│  (Price Feed Services, APIs, Market Data Providers)          │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        │ Signed Price Submissions
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              Oracle Aggregator Contract                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Price Submission Layer                               │   │
│  │  - Auth verification                                  │   │
│  │  - Price validation (> 0)                             │   │
│  │  - Ledger timestamp recording                         │   │
│  └──────────────────────────────────────────────────────┘   │
│                        │                                     │
│                        ▼                                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Aggregation Engine                                   │   │
│  │  1. Collect all submissions                           │   │
│  │  2. Sort prices                                       │   │
│  │  3. Compute median                                    │   │
│  │  4. Calculate tolerance band (±X%)                    │   │
│  │  5. Filter outliers                                   │   │
│  │  6. Recompute median from filtered set                │   │
│  └──────────────────────────────────────────────────────┘   │
│                        │                                     │
│                        ▼                                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Staleness Check                                      │   │
│  │  - Compare latest submission ledger to current        │   │
│  │  - Return None if beyond threshold                    │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                        │
                        │ get_price(asset_pair) -> Option<(i128, u64)>
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              Financing Pool Contract                          │
│  - Queries oracle for dynamic discount rate                  │
│  - Falls back to static discount if oracle unavailable       │
│  - Clamps oracle price between min/max bounds                │
└─────────────────────────────────────────────────────────────┘
```

### Data Structures

#### OracleConfig
```rust
pub struct OracleConfig {
    pub asset_pair: Symbol,        // e.g., "XLM/USDC"
    pub tolerance_bps: u32,        // e.g., 500 = 5% tolerance
    pub staleness_ledgers: u32,    // e.g., 100 ledgers ≈ 10 minutes
    pub authorized_submitters: Vec<Address>,
}
```

#### PriceSubmission
```rust
pub struct PriceSubmission {
    pub submitter: Address,
    pub asset_pair: Symbol,
    pub price: i128,               // Price in basis points
    pub ledger: u64,               // Ledger sequence when submitted
}
```

### Aggregation Algorithm

1. **Collect**: Gather all submissions from authorized submitters for the asset pair
2. **Validate**: Ensure at least 2 submissions exist
3. **Sort**: Order prices from lowest to highest
4. **Median**: Select the middle value (or average of two middle values for even counts)
5. **Tolerance Band**: Calculate ±tolerance% around the median
6. **Filter**: Remove prices outside the tolerance band
7. **Final Median**: Recompute median from filtered set
8. **Staleness**: Verify latest submission is within the staleness threshold

### Outlier Rejection

The tolerance band is configurable per asset pair and expressed in basis points (1/100th of a percent). For example:
- `tolerance_bps = 500` means ±5%
- If median = 1000, acceptable range is [950, 1050]
- Prices outside this range are rejected as outliers

This protects against:
- Submitter errors (fat-finger mistakes)
- Submitter manipulation (single bad actor)
- Market anomalies (flash crashes, spikes)

### Staleness Check

The contract tracks the ledger sequence of the most recent submission. If the current ledger minus the latest submission ledger exceeds `staleness_ledgers`, the price is considered stale and `get_price` returns `None`.

This ensures:
- Prices are fresh and reflect current market conditions
- Downstream contracts can detect and handle stale data
- The system fails safely when data is unavailable

## Security Considerations

### Authorized Submitters
- Only whitelisted addresses can submit prices
- Admin can add/remove submitters (requires admin signature)
- Prevents spam and unauthorized price manipulation

### Admin Controls
- Single admin address (can be upgraded to multisig)
- Admin can configure asset pairs, tolerance, and staleness
- Admin can manage submitter whitelist

### Price Validation
- Prices must be > 0 (rejects zero/negative values)
- At least 2 submissions required for aggregation
- Minimum 2 submissions after outlier filtering

### Fallback Behavior
- Financing pool falls back to static discount if oracle unavailable
- Oracle monitor service activates fallback mode on staleness
- Risk premium applied during fallback to compensate for uncertainty

## Integration with Financing Pool

The financing pool integrates with the oracle through:

1. **Configuration**: Admin sets oracle contract address, asset pair, min/max discount bounds
2. **Query**: When `fund_invoice` is called, the pool queries the oracle for the current discount rate
3. **Clamping**: Oracle price is clamped between min/max bounds to prevent extreme values
4. **Fallback**: If oracle returns `None` or is unreachable, static discount is used

```rust
fn get_effective_discount_bps(env: &Env) -> u32 {
    if let Some(config) = env.storage().instance().get(&DataKey::OracleDiscountConfig) {
        let oracle_config: OracleDiscountConfig = config;
        if oracle_config.enabled {
            if let Some(oracle_contract) = oracle_config.oracle_contract {
                if let Ok(Some((oracle_price, _))) = Self::query_oracle_price(...) {
                    return clamp(oracle_price, min, max);
                }
            }
        }
    }
    // Fallback to static discount
    env.storage().instance().get(&DataKey::DiscountBps).unwrap_or(0)
}
```

## Backend Price Feed Service

The backend includes a price feed service that:

1. **Fetches** market prices from external APIs (CoinGecko, Binance, etc.)
2. **Submits** signed price updates to the oracle contract
3. **Runs** on a configurable interval (default: 1 minute)
4. **Supports** multiple feeds for different asset pairs

Configuration via environment variables:
```json
{
  "ORACLE_PRICE_FEEDS": [
    {
      "feedId": "xlm-usdc",
      "assetPair": "XLM/USDC",
      "oracleContractId": "CABC...",
      "submitterWallet": "GABC...",
      "updateIntervalMs": 60000
    }
  ]
}
```

## Testing Strategy

### Unit Tests
- ✅ Median aggregation with 3 submitters, 1 outlier (outlier excluded)
- ✅ Staleness check (returns None if beyond threshold)
- ✅ Insufficient submissions (requires ≥ 2)
- ✅ Unauthorized submitter rejection
- ✅ Invalid price rejection (≤ 0)
- ✅ Duplicate submitter prevention
- ✅ Submitter revocation
- ✅ Multiple asset pairs

### Integration Tests
- End-to-end price submission and retrieval
- Financing pool discount calculation with oracle
- Fallback behavior when oracle is unavailable

### Acceptance Criteria
- [x] Oracle contract compiles and passes `cargo test --all`
- [x] Median aggregation test with 3 submitters, one outlier—proves outlier is excluded
- [x] Staleness check: `get_price` returns None if most recent update is older than configurable ledger count
- [ ] Backend service submits price updates and price is reflected in next `fund_invoice` call
- [ ] Architecture decision documented in docs/

## Future Enhancements

1. **Multi-oracle support**: Query multiple oracle contracts and aggregate results
2. **Historical data**: Store price history for analytics and dispute resolution
3. **Dispute mechanism**: Allow challenges to outlier prices with stake
4. **Weighted median**: Weight submitters by reputation/stake
5. **Time-weighted average**: Use TWAP instead of spot price for smoother rates
6. **Cross-chain oracles**: Integrate with Chainlink, Band Protocol, etc.

## References

- [Soroban Smart Contracts](https://soroban.stellar.org/docs)
- [Stellar Consensus Protocol](https://www.stellar.org/developers/learn/concepts/scp.html)
- [Chainlink Price Feeds](https://docs.chain.link/data-feeds)
- [MakerDAO Medianizer](https://docs.makerdao.org/smart-contract-modules/price-feeds)