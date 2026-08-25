import { ConfigService } from '@nestjs/config';

export interface MonitoringConfig {
  enabled: boolean;
  horizonUrl: string;
  contractIds: string[];
  pollFallbackMs: number;
  alertWebhookUrl?: string;
  alertWebhookKind: 'slack' | 'pagerduty' | 'generic';
  alertCooldownMs: number;
  maxLedgerLatencyMs: number;
  largeFundingAmount: number;
  fundingVolumeWindowMs: number;
  fundingVolumeThreshold: number;
  fundingVelocityWindowMs: number;
  fundingVelocityCountThreshold: number;
  oracleDeviationBps: number;
  pauserRoleNames: string[];
}

const numberFrom = (config: ConfigService, key: string, fallback: number): number => {
  const value = Number(config.get<string>(key) ?? fallback);
  return Number.isFinite(value) ? value : fallback;
};

const listFrom = (value?: string): string[] =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

export const loadMonitoringConfig = (config: ConfigService): MonitoringConfig => ({
  enabled: (config.get<string>('MONITORING_ENABLED') ?? 'true') !== 'false',
  horizonUrl: config.get<string>('STELLAR_HORIZON_URL') ?? 'https://horizon-testnet.stellar.org',
  contractIds: listFrom(config.get<string>('MONITORING_CONTRACT_IDS') ?? config.get<string>('INVOICE_CONTRACT_ID')),
  pollFallbackMs: numberFrom(config, 'MONITORING_LEDGER_POLL_FALLBACK_MS', 5_000),
  alertWebhookUrl: config.get<string>('ALERT_WEBHOOK_URL'),
  alertWebhookKind: (config.get<string>('ALERT_WEBHOOK_KIND') ?? 'generic') as MonitoringConfig['alertWebhookKind'],
  alertCooldownMs: numberFrom(config, 'ALERT_DEDUP_COOLDOWN_MS', 15 * 60_000),
  maxLedgerLatencyMs: numberFrom(config, 'MONITORING_MAX_LEDGER_LATENCY_MS', 10_000),
  largeFundingAmount: numberFrom(config, 'ANOMALY_LARGE_FUNDING_AMOUNT', 100_000),
  fundingVolumeWindowMs: numberFrom(config, 'ANOMALY_VOLUME_WINDOW_MS', 5 * 60_000),
  fundingVolumeThreshold: numberFrom(config, 'ANOMALY_VOLUME_THRESHOLD', 500_000),
  fundingVelocityWindowMs: numberFrom(config, 'ANOMALY_VELOCITY_WINDOW_MS', 60_000),
  fundingVelocityCountThreshold: numberFrom(config, 'ANOMALY_VELOCITY_COUNT_THRESHOLD', 25),
  oracleDeviationBps: numberFrom(config, 'ANOMALY_ORACLE_DEVIATION_BPS', 500),
  pauserRoleNames: listFrom(config.get<string>('ANOMALY_PAUSER_ROLE_NAMES') ?? 'pauser,emergency_pauser'),
});
