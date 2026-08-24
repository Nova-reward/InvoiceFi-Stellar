import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { loadMonitoringConfig, MonitoringConfig } from './monitoring.config';
import { AnomalyAlert, MonitoringEvent } from './types';

interface FundingPoint {
  amount: number;
  timestamp: number;
}

interface DiscountPoint {
  rate: number;
  timestamp: number;
}

@Injectable()
export class AnomalyDetectorService {
  private readonly config: MonitoringConfig;
  private readonly fundingWindow: FundingPoint[] = [];
  private readonly velocityWindow: FundingPoint[] = [];
  private readonly longTermFundingWindow: FundingPoint[] = [];
  private readonly discountWindow: DiscountPoint[] = [];

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

      this.pushAndTrim(this.fundingWindow, { amount: event.amount, timestamp: eventTime }, this.config.fundingVolumeWindowMs);
      const volume = this.fundingWindow.reduce((total, point) => total + point.amount, 0);
      if (volume >= this.config.fundingVolumeThreshold) {
        alerts.push(this.alert(event, 'funding_volume_spike', volume, this.config.fundingVolumeThreshold, 'critical'));
      }

      this.pushAndTrim(this.velocityWindow, { amount: event.amount, timestamp: eventTime }, this.config.fundingVelocityWindowMs);
      if (this.velocityWindow.length >= this.config.fundingVelocityCountThreshold) {
        alerts.push(this.alert(event, 'funding_velocity_spike', this.velocityWindow.length, this.config.fundingVelocityCountThreshold, 'warning'));
      }

      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      this.pushAndTrim(this.longTermFundingWindow, { amount: event.amount, timestamp: eventTime }, sevenDaysMs);
      
      if (this.config.relativeVolumeSpikeEnabled) {
        const total7DayVolume = this.longTermFundingWindow.reduce((total, point) => total + point.amount, 0);
        const average5MinVolume = total7DayVolume / 2016; // 2016 5-minute intervals in 7 days
        const threshold = average5MinVolume * this.config.relativeVolumeSpikeMultiple;
        
        if (threshold > 0 && volume >= threshold) {
          alerts.push(this.alert(event, 'relative_volume_spike', volume, threshold, 'critical'));
        }
      }

      if (this.config.unusualDiscountEnabled && typeof event.discountRate === 'number') {
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        
        if (this.discountWindow.length >= 2) {
          const mean = this.discountWindow.reduce((sum, p) => sum + p.rate, 0) / this.discountWindow.length;
          const variance = this.discountWindow.reduce((sum, p) => sum + Math.pow(p.rate - mean, 2), 0) / this.discountWindow.length;
          const stdDev = Math.sqrt(variance);
          
          const deviation = Math.abs(event.discountRate - mean);
          const maxDeviation = stdDev * this.config.unusualDiscountStdDevMultiple;
          
          if (deviation > maxDeviation && stdDev > 0) {
            alerts.push(this.alert(event, 'unusual_discount', event.discountRate, mean + maxDeviation, 'warning'));
          } else if (deviation > 0 && stdDev === 0) {
            alerts.push(this.alert(event, 'unusual_discount', event.discountRate, mean, 'warning'));
          }
        }
        
        this.pushAndTrim(this.discountWindow, { rate: event.discountRate, timestamp: eventTime }, thirtyDaysMs);
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

  private pushAndTrim<T extends { timestamp: number }>(window: T[], item: T, ttlMs: number): void {
    window.push(item);
    const earliest = item.timestamp - ttlMs;
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
