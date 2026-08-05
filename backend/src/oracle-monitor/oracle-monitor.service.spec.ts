import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OracleMonitorService } from './oracle-monitor.service';
import { OracleAlertService } from './oracle-alert.service';
import { FallbackStrategyService } from './fallback-strategy.service';
import { OracleMonitorConfig } from './oracle-monitor.types';

const mockConfig: Partial<OracleMonitorConfig> = {
  enabled: true,
  pollingIntervalMs: 1000,
  stalenessThresholdMs: 5000,
  warningThresholdMs: 3000,
  fallbackMode: 'last_known_good',
  fallbackRiskPremiumBps: 1000,
  maxRiskPremiumBps: 5000,
  feeds: [
    {
      feedId: 'xlm-usd',
      name: 'XLM/USD',
      contractAddress: 'CASMB...',
      stalenessThresholdMs: 5000,
      riskPremiumBps: 500,
    },
  ],
  alertCooldownMs: 60000,
  maxConsecutiveFailures: 3,
  sorobanRpcUrl: 'http://localhost:8001',
  horizonUrl: 'http://localhost:8000',
  networkPassphrase: 'Standalone Network ; February 2017',
};

function createMockConfigService(overrides: Record<string, string> = {}): ConfigService {
  const defaults: Record<string, string> = {
    ORACLE_MONITOR_ENABLED: 'true',
    ORACLE_POLLING_INTERVAL_MS: '1000',
    ORACLE_STALENESS_THRESHOLD_MS: '5000',
    ORACLE_WARNING_THRESHOLD_MS: '3000',
    ORACLE_FALLBACK_MODE: 'last_known_good',
    ORACLE_FALLBACK_RISK_PREMIUM_BPS: '1000',
    ORACLE_MAX_RISK_PREMIUM_BPS: '5000',
    ORACLE_MAX_CONSECUTIVE_FAILURES: '3',
    ORACLE_ALERT_COOLDOWN_MS: '60000',
    ORACLE_FEEDS_JSON: JSON.stringify(mockConfig.feeds),
    STELLAR_RPC_URL: 'http://localhost:8001',
    HORIZON_URL: 'http://localhost:8000',
    STELLAR_NETWORK_PASSPHRASE: 'Standalone Network ; February 2017',
    ...overrides,
  };
  return {
    get: (key: string) => defaults[key] ?? undefined,
  } as unknown as ConfigService;
}

describe('OracleMonitorService', () => {
  let service: OracleMonitorService;
  let alertService: jest.Mocked<OracleAlertService>;
  let fallbackStrategy: jest.Mocked<FallbackStrategyService>;
  let configService: ConfigService;

  beforeEach(async () => {
    alertService = {
      dispatch: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<OracleAlertService>;

    fallbackStrategy = {
      activate: jest.fn().mockResolvedValue(undefined),
      deactivate: jest.fn().mockResolvedValue(undefined),
      getActiveMode: jest.fn().mockReturnValue('none'),
      getRiskPremiumBps: jest.fn().mockReturnValue(0),
      shouldBlockFunding: jest.fn().mockReturnValue(false),
      calculateEffectiveDiscountBps: jest.fn().mockImplementation((bps: number) => bps),
      getActiveState: jest.fn().mockReturnValue(null),
      isHaltMode: jest.fn().mockReturnValue(false),
    } as unknown as jest.Mocked<FallbackStrategyService>;

    configService = createMockConfigService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OracleMonitorService,
        { provide: ConfigService, useValue: configService },
        { provide: OracleAlertService, useValue: alertService },
        { provide: FallbackStrategyService, useValue: fallbackStrategy },
      ],
    }).compile();

    service = module.get<OracleMonitorService>(OracleMonitorService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    service.onModuleDestroy();
  });

  describe('initialization', () => {
    it('should create the service', () => {
      expect(service).toBeDefined();
    });

    it('should return initial fallback mode from config', () => {
      expect(service.getFallbackMode()).toBe('last_known_good');
    });

    it('should return 0 risk premium initially', () => {
      expect(service.getFallbackRiskPremiumBps()).toBe(0);
    });

    it('should expose a feed', () => {
      service.onModuleInit();
      const feed = service.getFeed('xlm-usd');
      expect(feed).toBeDefined();
      expect(feed?.feedId).toBe('xlm-usd');
      expect(feed?.name).toBe('XLM/USD');
    });

    it('should not start polling when disabled', async () => {
      const disabledConfig = createMockConfigService({ ORACLE_MONITOR_ENABLED: 'false' });
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          OracleMonitorService,
          { provide: ConfigService, useValue: disabledConfig },
          { provide: OracleAlertService, useValue: alertService },
          { provide: FallbackStrategyService, useValue: fallbackStrategy },
        ],
      }).compile();

      const disabledService = module.get<OracleMonitorService>(OracleMonitorService);
      const pollSpy = jest.spyOn(disabledService as any, 'poll');
      disabledService.onModuleInit();
      expect(pollSpy).not.toHaveBeenCalled();
    });
  });

  describe('health endpoint', () => {
    it('should return ok status when feeds are healthy', async () => {
      service.onModuleInit();
      const health = await service.getHealth();

      expect(health.status).toBeDefined();
      expect(health.feeds).toBeDefined();
      expect(Array.isArray(health.feeds)).toBe(true);
      expect(health.feeds.length).toBe(1);
      expect(health.feeds[0].feedId).toBe('xlm-usd');
      expect(health.pollingIntervalMs).toBe(1000);
      expect(health.fallbackMode).toBe('last_known_good');
      expect(typeof health.uptimeSeconds).toBe('number');
    });

    it('should include per-feed freshness details', async () => {
      service.onModuleInit();
      const health = await service.getHealth();
      const feed = health.feeds[0];

      expect(feed).toHaveProperty('feedId');
      expect(feed).toHaveProperty('name');
      expect(feed).toHaveProperty('status');
      expect(feed).toHaveProperty('lastUpdateLedger');
      expect(feed).toHaveProperty('lastUpdatedAt');
      expect(feed).toHaveProperty('stalenessThresholdMs');
      expect(feed).toHaveProperty('staleMs');
      expect(feed).toHaveProperty('fallbackActive');
    });

    it('should report lastPollAt', async () => {
      service.onModuleInit();
      const health = await service.getHealth();
      expect(typeof health.lastPollAt).toBe('string');
    });
  });

  describe('polling', () => {
    it('should execute a poll cycle', async () => {
      service.onModuleInit();
      await service.forcePoll();
      expect(alertService.dispatch).toBeDefined();
    });

    it('should handle poll errors gracefully', async () => {
      service.onModuleInit();
      await expect(service.forcePoll()).resolves.not.toThrow();
    });
  });

  describe('cleanup', () => {
    it('should stop polling on destroy', () => {
      service.onModuleInit();
      expect(() => service.onModuleDestroy()).not.toThrow();
    });
  });
});
