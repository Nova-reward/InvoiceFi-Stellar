import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { loadOracleMonitorConfig } from './oracle-monitor.config';
import { OracleMonitorConfig, OracleAlert } from './oracle-monitor.types';

@Injectable()
export class OracleAlertService {
  private readonly logger = new Logger(OracleAlertService.name);
  private readonly config: OracleMonitorConfig;
  private readonly sentAt = new Map<string, number>();

  constructor(config: ConfigService) {
    this.config = loadOracleMonitorConfig(config);
  }

  async dispatch(alert: OracleAlert): Promise<boolean> {
    const now = Date.now();
    const previous = this.sentAt.get(alert.id);
    if (previous && now - previous < this.config.alertCooldownMs) {
      this.logger.debug(`Suppressed duplicate alert ${alert.id}`);
      return false;
    }

    this.sentAt.set(alert.id, now);
    this.logger.log(`Oracle alert: [${alert.severity}] ${alert.type} – ${alert.message}`);

    if (!this.config.alertWebhookUrl) {
      this.logger.warn(`No alert webhook configured; alert=${JSON.stringify({ type: alert.type, feedId: alert.feedId, severity: alert.severity, message: alert.message })}`);
      return true;
    }

    try {
      const payload = this.formatPayload(alert);
      const response = await fetch(this.config.alertWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        this.logger.error(`Alert webhook returned ${response.status}`);
        return false;
      }

      return true;
    } catch (err) {
      this.logger.error(`Alert webhook failed: ${(err as Error).message}`);
      return false;
    }
  }

  private formatPayload(alert: OracleAlert): Record<string, unknown> {
    const base = {
      alertId: alert.id,
      type: alert.type,
      severity: alert.severity,
      feedId: alert.feedId,
      message: alert.message,
      occurredAt: alert.occurredAt,
      feed: alert.feed,
    };

    if (this.config.alertWebhookKind === 'slack') {
      const icon = alert.severity === 'critical' ? ':rotating_light:' : ':warning:';
      return {
        text: `${icon} InvoiceFi Oracle ${alert.severity}: ${alert.message}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${alert.type}*\nFeed: ${alert.feedId}\nSeverity: ${alert.severity}\n${alert.message}`,
            },
          },
        ],
        ...base,
      };
    }

    if (this.config.alertWebhookKind === 'pagerduty') {
      return {
        routing_key: process.env.PAGERDUTY_ROUTING_KEY || '',
        event_action: 'trigger',
        dedup_key: alert.id,
        payload: {
          summary: alert.message,
          severity: alert.severity === 'critical' ? 'critical' : 'warning',
          source: 'invoicefi-oracle-monitor',
          custom_details: base,
        },
      };
    }

    return base;
  }
}
