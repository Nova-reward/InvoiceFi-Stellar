import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { loadMonitoringConfig, MonitoringConfig } from './monitoring.config';
import { AnomalyAlert, MonitoringEvent } from './types';

interface FundingPoint {
  amount: number;
  timestamp: number;
}

@Injectable()
export class AnomalyDetectorService {
  private readonly config: MonitoringConfig;
  private readonly fundingWindow: FundingPoint[] = [];
  private readonly velocityWindow: FundingPoint[] = [];

  constructor(config: ConfigService) {
    this.config = loadMonitoringConfig(config);
  }

  evaluate(event: MonitoringEvent): AnomalyAlert[] {
    const alerts: AnomalyAlert[] = [];
    const eventTime = event.closedAt.getTime();

    if (event.type === 'invoice_funded' && typeof event.amount === 'number') {
      if (event.amount >= this.config.largeFundingAmount) {
        alerts.push(this.alert(event, 'large_invoice_funding', event.amount, this.config.largeFundingAmount, 'critical'));
      }

      this.pushAndTrim(this.fundingWindow, event.amount, eventTime, this.config.fundingVolumeWindowMs);
      const volume = this.fundingWindow.reduce((total, point) => total + point.amount, 0);
      if (volume >= this.config.fundingVolumeThreshold) {
        alerts.push(this.alert(event, 'funding_volume_spike', volume, this.config.fundingVolumeThreshold, 'critical'));
      }

      this.pushAndTrim(this.velocityWindow, event.amount, eventTime, this.config.fundingVelocityWindowMs);
      if (this.velocityWindow.length >= this.config.fundingVelocityCountThreshold) {
        alerts.push(this.alert(event, 'funding_velocity_spike', this.velocityWindow.length, this.config.fundingVelocityCountThreshold, 'warning'));
      }
    }

    if (
      event.type === 'oracle_price_updated' &&
      typeof event.oraclePrice === 'number' &&
      typeof event.referencePrice === 'number' &&
      event.referencePrice > 0
    ) {
      const deviationBps = Math.abs(event.oraclePrice - event.referencePrice) / event.referencePrice * 10_000;
      if (deviationBps >= this.config.oracleDeviationBps) {
        alerts.push(this.alert(event, 'oracle_price_deviation', Math.round(deviationBps), this.config.oracleDeviationBps, 'critical'));
      }
    }

    if (event.type === 'role_changed' && this.isPauserRole(event.role)) {
      alerts.push(this.alert(event, 'pauser_role_changed', event.newValue ?? 'changed', this.config.pauserRoleNames.join(','), 'critical'));
    }

    return alerts;
  }

  private pushAndTrim(window: FundingPoint[], amount: number, timestamp: number, ttlMs: number): void {
    window.push({ amount, timestamp });
    const earliest = timestamp - ttlMs;
    while (window.length > 0 && window[0].timestamp < earliest) window.shift();
  }

  private isPauserRole(role?: string): boolean {
    if (!role) return false;
    return this.config.pauserRoleNames.some((name) => role.toLowerCase().includes(name.toLowerCase()));
  }

  private alert(
    event: MonitoringEvent,
    anomalyType: AnomalyAlert['anomalyType'],
    currentMetric: number | string,
    threshold: number | string,
    severity: AnomalyAlert['severity'],
  ): AnomalyAlert {
    const affected = event.account ?? event.contractId;
    return {
      id: `${anomalyType}:${affected}:${event.transactionHash}`,
      anomalyType,
      affectedAccountOrContract: affected,
      transactionHash: event.transactionHash,
      currentMetric,
      threshold,
      ledger: event.ledger,
      occurredAt: event.closedAt.toISOString(),
      severity,
      summary: `${anomalyType} detected for ${affected}`,
      context: { ...event },
    };
  }
}
