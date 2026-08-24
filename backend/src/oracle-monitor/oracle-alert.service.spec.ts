import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OracleAlertService } from './oracle-alert.service';
import { OracleAlert } from './oracle-monitor.types';

function createMockConfigService(overrides: Record<string, string> = {}): ConfigService {
  const defaults: Record<string, string> = {
    ORACLE_ALERT_WEBHOOK_URL: '',
    ORACLE_ALERT_WEBHOOK_KIND: 'generic',
    ORACLE_ALERT_COOLDOWN_MS: '60000',
    ORACLE_FEEDS_JSON: '[]',
    ...overrides,
  };
  return {
    get: (key: string) => defaults[key] ?? undefined,
  } as unknown as ConfigService;
}

describe('OracleAlertService', () => {
  let service: OracleAlertService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OracleAlertService,
        { provide: ConfigService, useValue: createMockConfigService() },
      ],
    }).compile();

    service = module.get<OracleAlertService>(OracleAlertService);
  });

  describe('dispatch', () => {
    it('should dispatch alert when no webhook configured (log only)', async () => {
      const alert: OracleAlert = {
        id: 'test-1',
        feedId: 'xlm-usd',
        severity: 'warning',
        type: 'staleness_breached',
        message: 'Test alert',
        feed: {
          feedId: 'xlm-usd',
          name: 'XLM/USD',
          status: 'stale',
          lastUpdateLedger: 100,
          lastUpdatedAt: new Date().toISOString(),
          stalenessThresholdMs: 5000,
          staleMs: 6000,
          fallbackActive: true,
        },
        occurredAt: new Date().toISOString(),
      };

      const result = await service.dispatch(alert);
      expect(result).toBe(true);
    });

    it('should deduplicate alerts within cooldown', async () => {
      const alert: OracleAlert = {
        id: 'dedup-test',
        feedId: 'xlm-usd',
        severity: 'warning',
        type: 'staleness_breached',
        message: 'Test dedup',
        feed: {
          feedId: 'xlm-usd',
          name: 'XLM/USD',
          status: 'stale',
          lastUpdateLedger: 100,
          lastUpdatedAt: new Date().toISOString(),
          stalenessThresholdMs: 5000,
          staleMs: 6000,
          fallbackActive: true,
        },
        occurredAt: new Date().toISOString(),
      };

      const result1 = await service.dispatch(alert);
      expect(result1).toBe(true);

      const result2 = await service.dispatch(alert);
      expect(result2).toBe(false);
    });

    it('should format Slack payload when configured', async () => {
      const slackConfig = createMockConfigService({
        ORACLE_ALERT_WEBHOOK_URL: 'https://hooks.slack.com/test',
        ORACLE_ALERT_WEBHOOK_KIND: 'slack',
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          OracleAlertService,
          { provide: ConfigService, useValue: slackConfig },
        ],
      }).compile();

      const slackService = module.get<OracleAlertService>(OracleAlertService);

      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response);

      const alert: OracleAlert = {
        id: 'slack-test',
        feedId: 'xlm-usd',
        severity: 'critical',
        type: 'staleness_breached',
        message: 'Feed stale',
        feed: {
          feedId: 'xlm-usd',
          name: 'XLM/USD',
          status: 'stale',
          lastUpdateLedger: 100,
          lastUpdatedAt: new Date().toISOString(),
          stalenessThresholdMs: 5000,
          staleMs: 6000,
          fallbackActive: true,
        },
        occurredAt: new Date().toISOString(),
      };

      await slackService.dispatch(alert);
      expect(fetchSpy).toHaveBeenCalled();

      const callBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(callBody.text).toContain('Oracle critical');
      expect(callBody.blocks).toBeDefined();
    });

    it('should format PagerDuty payload when configured', async () => {
      const pdConfig = createMockConfigService({
        ORACLE_ALERT_WEBHOOK_URL: 'https://events.pagerduty.com/test',
        ORACLE_ALERT_WEBHOOK_KIND: 'pagerduty',
        PAGERDUTY_ROUTING_KEY: 'test-key',
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          OracleAlertService,
          { provide: ConfigService, useValue: pdConfig },
        ],
      }).compile();

      const pdService = module.get<OracleAlertService>(OracleAlertService);

      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response);

      const alert: OracleAlert = {
        id: 'pd-test',
        feedId: 'xlm-usd',
        severity: 'critical',
        type: 'staleness_breached',
        message: 'Feed stale',
        feed: {
          feedId: 'xlm-usd',
          name: 'XLM/USD',
          status: 'stale',
          lastUpdateLedger: 100,
          lastUpdatedAt: new Date().toISOString(),
          stalenessThresholdMs: 5000,
          staleMs: 6000,
          fallbackActive: true,
        },
        occurredAt: new Date().toISOString(),
      };

      await pdService.dispatch(alert);
      expect(fetchSpy).toHaveBeenCalled();

      const pdCall = fetchSpy.mock.calls.find(
        (call) => typeof call[1]?.body === 'string' && call[1].body.includes('event_action'),
      );
      expect(pdCall).toBeDefined();
      const callBody = JSON.parse((pdCall![1] as any).body as string);
      expect(callBody.event_action).toBe('trigger');
      expect(callBody.payload.severity).toBe('critical');
    });

    it('should handle webhook failure gracefully', async () => {
      const webhookConfig = createMockConfigService({
        ORACLE_ALERT_WEBHOOK_URL: 'https://hooks.example.com/fail',
        ORACLE_ALERT_WEBHOOK_KIND: 'generic',
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          OracleAlertService,
          { provide: ConfigService, useValue: webhookConfig },
        ],
      }).compile();

      const failService = module.get<OracleAlertService>(OracleAlertService);

      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

      const alert: OracleAlert = {
        id: 'fail-test',
        feedId: 'xlm-usd',
        severity: 'warning',
        type: 'staleness_breached',
        message: 'Test',
        feed: {
          feedId: 'xlm-usd',
          name: 'XLM/USD',
          status: 'stale',
          lastUpdateLedger: 100,
          lastUpdatedAt: new Date().toISOString(),
          stalenessThresholdMs: 5000,
          staleMs: 6000,
          fallbackActive: true,
        },
        occurredAt: new Date().toISOString(),
      };

      const result = await failService.dispatch(alert);
      expect(result).toBe(false);
    });
  });
});
