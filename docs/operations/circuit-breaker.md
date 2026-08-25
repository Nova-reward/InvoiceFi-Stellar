# Circuit Breaker: Price Feed Staleness Protection

## Overview

The financing-pool backend integrates a circuit breaker that protects the system from repeatedly submitting funding requests when the oracle price feed is stale. This prevents wasting RPC calls and protects the pool from operating on outdated price data.

## Architecture

```
Backend Service → CircuitBreakerService → financing-pool contract
                         ↓
                    [OPEN state]
                    Rejects without RPC
```

## States

| State | Behavior |
|-------|----------|
| **CLOSED** | Normal operation. Funding requests proceed to the contract. |
| **OPEN** | Circuit is tripped. All funding requests are rejected immediately without hitting the RPC. |
| **HALF_OPEN** | Cool-down period has elapsed. Limited requests are allowed to test if the oracle feed has recovered. |

## Configuration

The circuit breaker is configured via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `CIRCUIT_BREAKER_FAILURE_THRESHOLD` | `5` | General failure threshold (non-staleness errors) before tripping. |
| `CIRCUIT_BREAKER_RESET_TIMEOUT_MS` | `60000` | Cool-down period in milliseconds before transitioning to HALF_OPEN. |
| `CIRCUIT_BREAKER_SUCCESS_THRESHOLD` | `2` | Number of consecutive successes required in HALF_OPEN to close the circuit. |
| `CIRCUIT_BREAKER_TIME_WINDOW_MS` | `10000` | Time window for counting failures (legacy, not actively used). |
| `CIRCUIT_BREAKER_STALENESS_FAILURE_THRESHOLD` | `3` | **Consecutive staleness errors** required to trip the circuit (stricter than general threshold). |

## Staleness Detection

The financing-pool contract enforces a maximum price feed age:

- **Constant**: `MAX_PRICE_AGE_LEDGERS = 100`
- **Error**: `StalePriceFeed` (error code 23)
- **Behavior**: `fund_invoice` reads the oracle's `(price, timestamp)` tuple and rejects the call if `current_ledger - timestamp > MAX_PRICE_AGE_LEDGERS`

## Circuit Breaker Behavior

### Tripping on Staleness

The circuit breaker tracks **consecutive staleness failures** separately from general failures:

1. When a funding call fails with a `StalePriceFeed` error, the `consecutiveStalenessFailures` counter increments.
2. When `consecutiveStalenessFailures >= CIRCUIT_BREAKER_STALENESS_FAILURE_THRESHOLD` (default: 3), the circuit transitions to **OPEN**.
3. Non-staleness errors reset the staleness counter to 0.

This is stricter than the general failure threshold because staleness errors indicate a systemic oracle issue rather than a transient RPC failure.

### Recovery

1. After `CIRCUIT_BREAKER_RESET_TIMEOUT_MS` (default: 60 seconds), the circuit transitions to **HALF_OPEN**.
2. In HALF_OPEN state, the next funding request is allowed through.
3. If it succeeds, the circuit transitions back to **CLOSED** after `CIRCUIT_BREAKER_SUCCESS_THRESHOLD` (default: 2) consecutive successes.
4. If it fails, the circuit returns to **OPEN** and the cool-down timer resets.

### Manual Reset

Operators can manually reset the circuit:

```typescript
circuitBreakerService.reset('financing-pool-funding');
```

## Usage in Backend

```typescript
import { CircuitBreakerService } from './common/circuit-breaker.service';

// Execute a funding request with staleness detection
const result = await circuitBreakerService.execute(
  'financing-pool-funding',
  () => fundingRepository.fundInvoice(invoice),
  () => fallbackService.handleStaleFeed(invoice),  // optional fallback
  {
    isStalenessError: (error) => {
      // Detect StalePriceFeed errors from the contract
      return error instanceof ContractError && error.code === 23;
    }
  }
);
```

## Monitoring

### Key Metrics

- `circuit_breaker_state{name="financing-pool-funding"}` - Current state (CLOSED/OPEN/HALF_OPEN)
- `circuit_breaker_failures{name="financing-pool-funding"}` - Total failure count
- `circuit_breaker_consecutive_staleness{name="financing-pool-funding"}` - Current staleness streak

### Alerts

| Alert | Condition | Severity |
|-------|-----------|----------|
| Circuit Open | `circuit_breaker_state == "OPEN"` | Critical |
| High Staleness Rate | `circuit_breaker_consecutive_staleness >= 2` | Warning |
| Prolonged Outage | `circuit_breaker_state == "OPEN" for > 5m` | Critical |

## Runbook

### Circuit is OPEN

1. **Verify oracle feed status**: Check if the price feed adapter is running and connected.
2. **Check feed timestamp**: Query `get_price_feed` on the contract to see the last update.
3. **Refresh the feed**: If the feed is stale, trigger a manual price update via `set_price_feed`.
4. **Wait for cool-down**: The circuit will automatically transition to HALF_OPEN after 60 seconds.
5. **Manual reset (emergency)**: If the feed is confirmed fresh but the circuit is still OPEN, use `circuitBreakerService.reset('financing-pool-funding')`.

### Repeated Staleness Errors

If the circuit trips repeatedly:

1. Investigate the oracle data source (out of scope for this integration).
2. Consider increasing `CIRCUIT_BREAKER_STALENESS_FAILURE_THRESHOLD` if the oracle has known latency.
3. Review `MAX_PRICE_AGE_LEDGERS` on the contract if business requirements allow older feeds.

## Testing

Unit tests cover:

- Trip after 3 consecutive staleness errors
- Non-staleness errors do not trip until general threshold (5)
- Staleness counter resets after a success
- HALF_OPEN recovery flow
- Manual reset

Run tests:

```bash
cd backend && npm test -- circuit-breaker.service.spec.ts
cd contracts/financing-pool && cargo test