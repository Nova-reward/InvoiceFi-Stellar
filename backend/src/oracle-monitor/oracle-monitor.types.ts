export type FeedStatus = 'healthy' | 'stale' | 'unknown';

export type FallbackMode = 'none' | 'last_known_good' | 'halt';

export interface OracleFeed {
  feedId: string;
  name: string;
  contractAddress: string;
  stalenessThresholdMs: number;
  riskPremiumBps: number;
  lastKnownPrice: number | null;
  lastUpdateLedger: number;
  lastUpdatedAt: Date;
  status: FeedStatus;
  fallbackActive: boolean;
}

export interface FeedHealthReport {
  feedId: string;
  name: string;
  status: FeedStatus;
  lastUpdateLedger: number;
  lastUpdatedAt: string;
  stalenessThresholdMs: number;
  staleMs: number;
  fallbackActive: boolean;
}

export interface OracleHealthResponse {
  status: 'ok' | 'degraded' | 'critical';
  feeds: FeedHealthReport[];
  fallbackMode: FallbackMode;
  fallbackRiskPremiumBps: number;
  pollingIntervalMs: number;
  lastPollAt: string;
  uptimeSeconds: number;
  alertCooldownMs: number;
}

export interface OracleAlert {
  id: string;
  feedId: string;
  severity: 'warning' | 'critical';
  type: 'staleness_breached' | 'price_deviation' | 'fallback_activated' | 'fallback_deactivated';
  message: string;
  feed: FeedHealthReport;
  occurredAt: string;
}

export interface OracleMonitorConfig {
  enabled: boolean;
  pollingIntervalMs: number;
  stalenessThresholdMs: number;
  warningThresholdMs: number;
  fallbackMode: FallbackMode;
  fallbackRiskPremiumBps: number;
  maxRiskPremiumBps: number;
  feeds: Array<{
    feedId: string;
    name: string;
    contractAddress: string;
    stalenessThresholdMs: number;
    riskPremiumBps: number;
  }>;
  alertWebhookUrl?: string;
  alertWebhookKind: 'slack' | 'pagerduty' | 'generic';
  alertCooldownMs: number;
  maxConsecutiveFailures: number;
  sorobanRpcUrl: string;
  horizonUrl: string;
  networkPassphrase: string;
}
