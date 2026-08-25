import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FallbackStrategyService } from './fallback-strategy.service';

function createMockConfigService(overrides: Record<string, string> = {}): ConfigService {
  const defaults: Record<string, string> = {
    ORACLE_FALLBACK_MODE: 'last_known_good',
    ORACLE_FALLBACK_RISK_PREMIUM_BPS: '1000',
    ORACLE_MAX_RISK_PREMIUM_BPS: '5000',
    ORACLE_FEEDS_JSON: '[]',
    ...overrides,
  };
  return {
    get: (key: string) => defaults[key] ?? undefined,
  } as unknown as ConfigService;
}

describe('FallbackStrategyService', () => {
  let service: FallbackStrategyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FallbackStrategyService,
        { provide: ConfigService, useValue: createMockConfigService() },
      ],
    }).compile();

    service = module.get<FallbackStrategyService>(FallbackStrategyService);
  });

  describe('initial state', () => {
    it('should start with no active mode', () => {
      expect(service.getActiveMode()).toBe('none');
    });

    it('should start with 0 risk premium', () => {
      expect(service.getRiskPremiumBps()).toBe(0);
    });

    it('should not be in halt mode', () => {
      expect(service.isHaltMode()).toBe(false);
    });

    it('should not block funding', () => {
      expect(service.shouldBlockFunding()).toBe(false);
    });

    it('should return null for active state', () => {
      expect(service.getActiveState()).toBeNull();
    });
  });

  describe('activation', () => {
    it('should activate last_known_good mode', async () => {
      await service.activate({ mode: 'last_known_good', riskPremiumBps: 1500, reason: 'test' });

      expect(service.getActiveMode()).toBe('last_known_good');
      expect(service.getRiskPremiumBps()).toBe(1500);
      expect(service.getActiveState()).not.toBeNull();
      expect(service.getActiveState()?.reason).toBe('test');
    });

    it('should activate halt mode', async () => {
      await service.activate({ mode: 'halt', riskPremiumBps: 0, reason: 'emergency' });

      expect(service.getActiveMode()).toBe('halt');
      expect(service.isHaltMode()).toBe(true);
      expect(service.shouldBlockFunding()).toBe(true);
    });

    it('should cap risk premium at max', async () => {
      await service.activate({ mode: 'last_known_good', riskPremiumBps: 99999, reason: 'test' });

      expect(service.getRiskPremiumBps()).toBe(5000);
    });

    it('should ignore duplicate activation', async () => {
      await service.activate({ mode: 'last_known_good', riskPremiumBps: 1000, reason: 'first' });
      await service.activate({ mode: 'halt', riskPremiumBps: 0, reason: 'second' });

      expect(service.getActiveMode()).toBe('last_known_good');
    });
  });

  describe('deactivation', () => {
    it('should deactivate active fallback', async () => {
      await service.activate({ mode: 'last_known_good', riskPremiumBps: 1000, reason: 'test' });
      expect(service.getActiveMode()).toBe('last_known_good');

      await service.deactivate();
      expect(service.getActiveMode()).toBe('none');
      expect(service.getRiskPremiumBps()).toBe(0);
    });

    it('should handle deactivation when nothing active', async () => {
      await expect(service.deactivate()).resolves.not.toThrow();
      expect(service.getActiveMode()).toBe('none');
    });
  });

  describe('discount calculation', () => {
    it('should return base discount when no fallback active', () => {
      expect(service.calculateEffectiveDiscountBps(500)).toBe(500);
    });

    it('should add risk premium to base discount', async () => {
      await service.activate({ mode: 'last_known_good', riskPremiumBps: 1000, reason: 'test' });
      expect(service.calculateEffectiveDiscountBps(500)).toBe(1500);
    });

    it('should not exceed max risk premium', async () => {
      await service.activate({ mode: 'last_known_good', riskPremiumBps: 5000, reason: 'test' });
      expect(service.calculateEffectiveDiscountBps(5000)).toBe(5000);
    });
  });
});
