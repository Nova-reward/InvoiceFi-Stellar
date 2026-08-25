import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { loadMonitoringConfig, MonitoringConfig } from './monitoring.config';
import { AnomalyAlert } from './types';

@Injectable()
export class AlertDispatcherService {
  private readonly logger = new Logger(AlertDispatcherService.name);
  private readonly config: MonitoringConfig;
  private readonly sentAt = new Map<string, number>();

  constructor(config: ConfigService) {
    this.config = loadMonitoringConfig(config);
  }

  async dispatch(alert: AnomalyAlert): Promise<boolean> {
    const now = Date.now();
    const previous = this.sentAt.get(alert.id);
    if (previous && now - previous < this.config.alertCooldownMs) {
      this.logger.debug(`Suppressed duplicate alert ${alert.id}`);
      return false;
    }

    this.sentAt.set(alert.id, now);
    const payload = this.formatPayload(alert);
    if (!this.config.alertWebhookUrl) {
      this.logger.warn(`Alert webhook not configured; anomaly=${JSON.stringify(payload)}`);
      return true;
    }

    const response = await fetch(this.config.alertWebhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Alert webhook failed with ${response.status}`);
    return true;
  }

  private formatPayload(alert: AnomalyAlert): Record<string, unknown> {
    if (this.config.alertWebhookKind === 'slack') {
      return {
        text: `InvoiceFi ${alert.severity} anomaly: ${alert.summary}`,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `*${alert.anomalyType}*\nAffected: ${alert.affectedAccountOrContract}\nTx: ${alert.transactionHash}\nMetric: ${alert.currentMetric}\nThreshold: ${alert.threshold}` } }],
        alert,
      };
    }
    if (this.config.alertWebhookKind === 'pagerduty') {
      return {
        routing_key: process.env.PAGERDUTY_ROUTING_KEY,
        event_action: 'trigger',
        dedup_key: alert.id,
        payload: { summary: alert.summary, severity: alert.severity === 'critical' ? 'critical' : 'warning', source: 'invoicefi-monitoring', custom_details: alert },
      };
    }
    return { ...alert };
  }
}
