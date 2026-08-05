import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { loadOracleMonitorConfig } from './oracle-monitor.config';
import { OracleMonitorConfig } from './oracle-monitor.types';
import {
  OracleFeed,
  FeedHealthReport,
  FeedStatus,
  FallbackMode,
  OracleHealthResponse,
  OracleAlert,
} from './oracle-monitor.types';
import { OracleAlertService } from './oracle-alert.service';
import { FallbackStrategyService } from './fallback-strategy.service';

@Injectable()
export class OracleMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OracleMonitorService.name);
  private readonly config: OracleMonitorConfig;
  private readonly feeds = new Map<string, OracleFeed>();
  private pollTimer?: ReturnType<typeof setInterval>;
  private startedAt = Date.now();
  private lastPollAt: Date | null = null;
  private consecutiveFailures = 0;
  private fallbackMode: FallbackMode = 'none';
  private fallbackRiskPremiumBps = 0;

  constructor(
    config: ConfigService,
    private readonly alertService: OracleAlertService,
    private readonly fallbackStrategy: FallbackStrategyService,
  ) {
    this.config = loadOracleMonitorConfig(config);
    this.fallbackMode = this.config.fallbackMode;
  }

  onModuleInit(): void {
    if (!this.config.enabled) {
      this.logger.log('Oracle monitoring disabled');
      return;
    }

    for (const feedCfg of this.config.feeds) {
      this.feeds.set(feedCfg.feedId, {
        feedId: feedCfg.feedId,
        name: feedCfg.name,
        contractAddress: feedCfg.contractAddress,
        stalenessThresholdMs: feedCfg.stalenessThresholdMs,
        riskPremiumBps: feedCfg.riskPremiumBps,
        lastKnownPrice: null,
        lastUpdateLedger: 0,
        lastUpdatedAt: new Date(0),
        status: 'unknown',
        fallbackActive: false,
      });
    }

    this.logger.log(
      `Oracle monitor initialised: ${this.feeds.size} feeds, polling every ${this.config.pollingIntervalMs}ms`,
    );

    this.poll();
    this.pollTimer = setInterval(() => this.poll(), this.config.pollingIntervalMs);
  }

  onModuleDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  async poll(): Promise<void> {
    this.lastPollAt = new Date();
    let allHealthy = true;
    const alerts: OracleAlert[] = [];

    for (const [, feed] of this.feeds) {
      try {
        await this.checkFeed(feed);
      } catch (err) {
        this.logger.error(`Error checking feed ${feed.feedId}: ${(err as Error).message}`);
        feed.status = 'unknown';
        allHealthy = false;
      }

      const feedAlerts = this.evaluateFeed(feed);
      alerts.push(...feedAlerts);

      if (feed.status !== 'healthy') {
        allHealthy = false;
      }
    }

    this.consecutiveFailures = allHealthy ? 0 : this.consecutiveFailures + 1;

    if (this.consecutiveFailures >= this.config.maxConsecutiveFailures && this.fallbackMode === 'none') {
      await this.activateFallback('staleness_breached', 'Multiple oracle feeds stale, activating fallback');
    }

    for (const alert of alerts) {
      await this.alertService.dispatch(alert);
    }
  }

  private async checkFeed(feed: OracleFeed): Promise<void> {
    if (!feed.contractAddress) {
      this.logger.debug(`Feed ${feed.feedId} has no contract address, marking unknown`);
      feed.status = 'unknown';
      return;
    }

    try {
      const ledgerInfo = await this.fetchLedgerInfo();
      const currentLedger = ledgerInfo.sequence;
      const now = Date.now();

      feed.lastUpdateLedger = currentLedger;
      feed.lastUpdatedAt = new Date(now);
      feed.lastKnownPrice = await this.fetchOraclePrice(feed.contractAddress);

      const staleMs = now - feed.lastUpdatedAt.getTime();
      if (staleMs > feed.stalenessThresholdMs) {
        feed.status = 'stale';
      } else if (staleMs > this.config.warningThresholdMs) {
        feed.status = 'stale';
      } else {
        feed.status = 'healthy';
      }
    } catch (err) {
      this.logger.warn(`Failed to poll feed ${feed.feedId}: ${(err as Error).message}`);
      feed.status = 'unknown';
    }
  }

  private evaluateFeed(feed: OracleFeed): OracleAlert[] {
    const alerts: OracleAlert[] = [];
    const now = new Date();
    const staleMs = now.getTime() - feed.lastUpdatedAt.getTime();

    if (feed.status === 'stale' && !feed.fallbackActive) {
      feed.fallbackActive = true;
      alerts.push({
        id: `stale:${feed.feedId}:${now.getTime()}`,
        feedId: feed.feedId,
        severity: staleMs > feed.stalenessThresholdMs ? 'critical' : 'warning',
        type: 'staleness_breached',
        message: `Oracle feed "${feed.name}" is stale (${Math.round(staleMs / 1000)}s since last update, threshold: ${Math.round(feed.stalenessThresholdMs / 1000)}s)`,
        feed: this.toHealthReport(feed),
        occurredAt: now.toISOString(),
      });
    }

    if (feed.status === 'healthy' && feed.fallbackActive) {
      feed.fallbackActive = false;
      alerts.push({
        id: `recovered:${feed.feedId}:${now.getTime()}`,
        feedId: feed.feedId,
        severity: 'warning',
        type: 'fallback_deactivated',
        message: `Oracle feed "${feed.name}" recovered, deactivating fallback`,
        feed: this.toHealthReport(feed),
        occurredAt: now.toISOString(),
      });
    }

    return alerts;
  }

  private async activateFallback(type: OracleAlert['type'], message: string): Promise<void> {
    if (this.fallbackMode !== 'none') return;

    this.fallbackMode = this.config.fallbackMode || 'last_known_good';
    this.fallbackRiskPremiumBps = this.config.fallbackRiskPremiumBps;

    this.logger.warn(
      `Activating fallback mode: ${this.fallbackMode} (risk premium: ${this.fallbackRiskPremiumBps} bps)`,
    );

    await this.fallbackStrategy.activate({
      mode: this.fallbackMode,
      riskPremiumBps: this.fallbackRiskPremiumBps,
      reason: message,
    });

    await this.alertService.dispatch({
      id: `fallback:activate:${Date.now()}`,
      feedId: 'system',
      severity: 'critical',
      type: 'fallback_activated',
      message: `Fallback mode activated: ${this.fallbackMode}. ${message}`,
      feed: {
        feedId: 'system',
        name: 'System',
        status: 'stale',
        lastUpdateLedger: 0,
        lastUpdatedAt: new Date().toISOString(),
        stalenessThresholdMs: 0,
        staleMs: 0,
        fallbackActive: true,
      },
      occurredAt: new Date().toISOString(),
    });
  }

  private async deactivateFallback(): Promise<void> {
    if (this.fallbackMode === 'none') return;

    const allHealthy = Array.from(this.feeds.values()).every((f) => f.status === 'healthy');
    if (!allHealthy) return;

    this.logger.log('All feeds healthy, deactivating fallback mode');
    this.fallbackMode = 'none';
    this.fallbackRiskPremiumBps = 0;
    this.consecutiveFailures = 0;

    await this.fallbackStrategy.deactivate();
  }

  async getHealth(): Promise<OracleHealthResponse> {
    const feedReports = Array.from(this.feeds.values()).map((f) => this.toHealthReport(f));
    const anyStale = feedReports.some((f) => f.status === 'stale');
    const anyUnknown = feedReports.some((f) => f.status === 'unknown');

    let status: OracleHealthResponse['status'] = 'ok';
    if (anyStale || this.fallbackMode !== 'none') status = 'degraded';
    if (feedReports.every((f) => f.status === 'stale' || f.status === 'unknown')) status = 'critical';

    return {
      status,
      feeds: feedReports,
      fallbackMode: this.fallbackMode,
      fallbackRiskPremiumBps: this.fallbackRiskPremiumBps,
      pollingIntervalMs: this.config.pollingIntervalMs,
      lastPollAt: this.lastPollAt?.toISOString() ?? new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      alertCooldownMs: this.config.alertCooldownMs,
    };
  }

  getFallbackMode(): FallbackMode {
    return this.fallbackMode;
  }

  getFallbackRiskPremiumBps(): number {
    return this.fallbackRiskPremiumBps;
  }

  getFeed(feedId: string): OracleFeed | undefined {
    return this.feeds.get(feedId);
  }

  async forcePoll(): Promise<void> {
    await this.poll();
  }

  private toHealthReport(feed: OracleFeed): FeedHealthReport {
    const now = Date.now();
    const staleMs = now - feed.lastUpdatedAt.getTime();
    return {
      feedId: feed.feedId,
      name: feed.name,
      status: feed.status,
      lastUpdateLedger: feed.lastUpdateLedger,
      lastUpdatedAt: feed.lastUpdatedAt.toISOString(),
      stalenessThresholdMs: feed.stalenessThresholdMs,
      staleMs: feed.status === 'unknown' ? 0 : staleMs,
      fallbackActive: feed.fallbackActive,
    };
  }

  private async fetchLedgerInfo(): Promise<{ sequence: number }> {
    try {
      const horizonUrl = this.config.horizonUrl;
      const response = await fetch(`${horizonUrl}/ledgers?order=desc&limit=1`);
      if (!response.ok) {
        throw new Error(`Horizon returned ${response.status}`);
      }
      const data = (await response.json()) as { _embedded?: { records?: Array<{ sequence: number }> } };
      const sequence = data._embedded?.records?.[0]?.sequence;
      if (typeof sequence !== 'number') {
        throw new Error('No ledger sequence found in Horizon response');
      }
      return { sequence };
    } catch (err) {
      this.logger.debug(`Horizon ledger fetch failed, using simulated ledger: ${(err as Error).message}`);
      return { sequence: Math.floor(Date.now() / 6000) };
    }
  }

  private async fetchOraclePrice(contractAddress: string): Promise<number | null> {
    try {
      const rpcUrl = this.config.sorobanRpcUrl;
      const response = await fetch(`${rpcUrl}/soroban/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'simulateTransaction',
          params: [contractAddress, 'get_price'],
        }),
      });

      if (!response.ok) return null;

      const data = (await response.json()) as { result?: { xdr?: string } };
      if (data.result?.xdr) {
        return parseFloat(Buffer.from(data.result.xdr, 'base64').toString('utf-8')) || null;
      }
      return null;
    } catch {
      return null;
    }
  }
}
