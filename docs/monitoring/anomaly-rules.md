# On-chain anomaly detection rules

The backend `MonitoringModule` tails Stellar ledger-close events through Horizon Server-Sent Events and evaluates normalized protocol events before sending structured alerts to `ALERT_WEBHOOK_URL`. The service warns when ledger processing latency exceeds `MONITORING_MAX_LEDGER_LATENCY_MS`; the default is 10 seconds to match on-call response expectations.

## Alert payload context

Every alert includes the anomaly type, affected account or contract, transaction hash, ledger, occurrence time, current metric, configured threshold, severity, and the normalized event context. Slack, PagerDuty, and generic JSON webhooks are supported with `ALERT_WEBHOOK_KIND=slack|pagerduty|generic`.

## Deduplication

`ALERT_DEDUP_COOLDOWN_MS` suppresses repeats for the same anomaly id. The default is 15 minutes, long enough to avoid paging storms during a single incident while still allowing a renewed page if the condition persists after triage.

## Rules and defaults

| Rule | Event input | Default threshold | Justification |
| --- | --- | --- | --- |
| Large single invoice funding | `invoice_funded.amount` | `ANOMALY_LARGE_FUNDING_AMOUNT=100000` | A single funding above typical SME invoice sizes is rare and should be verified for fat-finger or malicious activity. |
| Funding volume spike | Sum of funded invoice amounts in `ANOMALY_VOLUME_WINDOW_MS` | `ANOMALY_VOLUME_THRESHOLD=500000` over 5 minutes | A rapid pool drawdown can indicate coordinated abuse or broken pricing; five minutes gives fast detection without paging on normal ledger batching. |
| Funding velocity spike | Count of funded invoices in `ANOMALY_VELOCITY_WINDOW_MS` | `ANOMALY_VELOCITY_COUNT_THRESHOLD=25` per minute | High transaction count with smaller sizes can bypass single-amount checks and may indicate bot activity. |
| Oracle price deviation | Absolute difference between oracle and reference price | `ANOMALY_ORACLE_DEVIATION_BPS=500` (5%) | A 5% deviation is larger than expected stable invoice collateral movements and can materially misprice financing. |
| Contract pauser role changed | Role-change event whose role contains `pauser` or `emergency_pauser` | Any change | Pauser administration is security-critical; every grant, revoke, or transfer needs immediate human review. |

Tune these defaults per deployment after observing normal production funding distributions. For launch, prefer lower thresholds with Slack-only routing, then move critical alerts to PagerDuty once false positives are understood.
