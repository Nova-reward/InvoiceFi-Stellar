import { ConfigService } from '@nestjs/config';
import { OracleMonitorConfig, FallbackMode } from './oracle-monitor.types';

const numberFrom = (config: ConfigService, key: string, fallback: number): number => {
  const value = Number(config.get<string>(key) ?? fallback);
  return Number.isFinite(value) ? value : fallback;
};

const parseFeeds = (raw?: string): OracleMonitorConfig['feeds'] => {
  if (!raw) {
    return [
      {
        feedId: 'xlm-usd',
        name: 'XLM/USD Oracle',
        contractAddress: process.env.ORACLE_FEED_XLM_USD_ADDRESS || '',
        stalenessThresholdMs: 300_000,
        riskPremiumBps: 500,
      },
      {
        feedId: 'usdc-usd',
        name: 'USDC/USD Oracle',
        contractAddress: process.env.ORACLE_FEED_USDC_USD_ADDRESS || '',
        stalenessThresholdMs: 300_000,
        riskPremiumBps: 200,
      },
    ];
  }

  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
};

export const loadOracleMonitorConfig = (config: ConfigService): OracleMonitorConfig => ({
  enabled: (config.get<string>('ORACLE_MONITOR_ENABLED') ?? 'true') !== 'false',
  pollingIntervalMs: numberFrom(config, 'ORACLE_POLLING_INTERVAL_MS', 30_000),
  stalenessThresholdMs: numberFrom(config, 'ORACLE_STALENESS_THRESHOLD_MS', 300_000),
  warningThresholdMs: numberFrom(config, 'ORACLE_WARNING_THRESHOLD_MS', 240_000),
  fallbackMode: (config.get<string>('ORACLE_FALLBACK_MODE') ?? 'none') as FallbackMode,
  fallbackRiskPremiumBps: numberFrom(config, 'ORACLE_FALLBACK_RISK_PREMIUM_BPS', 1000),
  maxRiskPremiumBps: numberFrom(config, 'ORACLE_MAX_RISK_PREMIUM_BPS', 5000),
  feeds: parseFeeds(config.get<string>('ORACLE_FEEDS_JSON')),
  alertWebhookUrl: config.get<string>('ORACLE_ALERT_WEBHOOK_URL'),
  alertWebhookKind: (config.get<string>('ORACLE_ALERT_WEBHOOK_KIND') ?? config.get<string>('ALERT_WEBHOOK_KIND') ?? 'generic') as OracleMonitorConfig['alertWebhookKind'],
  alertCooldownMs: numberFrom(config, 'ORACLE_ALERT_COOLDOWN_MS', 300_000),
  maxConsecutiveFailures: numberFrom(config, 'ORACLE_MAX_CONSECUTIVE_FAILURES', 3),
  sorobanRpcUrl: config.get<string>('STELLAR_RPC_URL') ?? 'http://localhost:8001',
  horizonUrl: config.get<string>('HORIZON_URL') ?? config.get<string>('STELLAR_HORIZON_URL') ?? 'http://localhost:8000',
  networkPassphrase: config.get<string>('STELLAR_NETWORK_PASSPHRASE') ?? 'Standalone Network ; February 2017',
});
