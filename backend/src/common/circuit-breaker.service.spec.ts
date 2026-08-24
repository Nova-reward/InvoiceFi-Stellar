import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { CircuitBreakerService, CircuitState } from './circuit-breaker.service';

describe('CircuitBreakerService', () => {
  let service: CircuitBreakerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CircuitBreakerService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key) => {
              const defaults: Record<string, string> = {
                CIRCUIT_BREAKER_FAILURE_THRESHOLD: '5',
                CIRCUIT_BREAKER_RESET_TIMEOUT_MS: '100',
                CIRCUIT_BREAKER_SUCCESS_THRESHOLD: '2',
                CIRCUIT_BREAKER_TIME_WINDOW_MS: '10000',
              };
              return defaults[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<CircuitBreakerService>(CircuitBreakerService);
  });

  describe('execute', () => {
    it('should execute function when circuit is closed', async () => {
      const fn = jest.fn().mockResolvedValue('success');

      const result = await service.execute('test', fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalled();
    });

    it('should transition to open after threshold failures', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fail'));

      for (let i = 0; i < 5; i++) {
        try {
          await service.execute('failing', fn);
        } catch (e) {
          // Expected to fail
        }
      }

      expect(service.getState('failing')).toBe(CircuitState.OPEN);
    });

    it('should reject requests when circuit is open', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fail'));

      // Trigger circuit open
      for (let i = 0; i < 5; i++) {
        try {
          await service.execute('open-circuit', fn);
        } catch (e) {
          // Expected
        }
      }

      // Next call should throw ServiceUnavailableException
      await expect(service.execute('open-circuit', () => Promise.resolve('ok'))).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('should use fallback when circuit is open', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fail'));
      const fallback = jest.fn().mockResolvedValue('fallback');

      // Trigger circuit open
      for (let i = 0; i < 5; i++) {
        try {
          await service.execute('fallback-test', fn);
        } catch (e) {
          // Expected
        }
      }

      const result = await service.execute('fallback-test', () => Promise.resolve('ok'), fallback);

      expect(result).toBe('fallback');
      expect(fallback).toHaveBeenCalled();
    });

    it('should transition to half-open after reset timeout', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fail'));

      // Trigger circuit open
      for (let i = 0; i < 5; i++) {
        try {
          await service.execute('half-open-test', fn);
        } catch (e) {
          // Expected
        }
      }

      expect(service.getState('half-open-test')).toBe(CircuitState.OPEN);

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Next call should transition to HALF_OPEN
      const successFn = jest.fn().mockResolvedValue('recovered');
      const result = await service.execute('half-open-test', successFn);

      expect(result).toBe('recovered');
      expect(service.getState('half-open-test')).toBe(CircuitState.HALF_OPEN);
    });

    it('should close circuit after success threshold in half-open', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fail'));
      const successFn = jest.fn().mockResolvedValue('ok');

      // Trigger circuit open
      for (let i = 0; i < 5; i++) {
        try {
          await service.execute('recovery-test', fn);
        } catch (e) {
          // Expected
        }
      }

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Two successful calls
      await service.execute('recovery-test', successFn);
      await service.execute('recovery-test', successFn);

      expect(service.getState('recovery-test')).toBe(CircuitState.CLOSED);
    });

    it('should reset circuit manually', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fail'));

      // Trigger circuit open
      for (let i = 0; i < 5; i++) {
        try {
          await service.execute('manual-reset', fn);
        } catch (e) {
          // Expected
        }
      }

      expect(service.getState('manual-reset')).toBe(CircuitState.OPEN);

      service.reset('manual-reset');

      expect(service.getState('manual-reset')).toBe(CircuitState.CLOSED);
    });

    it('should trip after 3 consecutive staleness errors', async () => {
      const stalenessError = new Error('StalePriceFeed');
      const fn = jest.fn().mockRejectedValue(stalenessError);

      for (let i = 0; i < 3; i++) {
        try {
          await service.execute('staleness-circuit', fn, undefined, {
            isStalenessError: (error) => (error as Error).message === 'StalePriceFeed',
          });
        } catch (e) {
          // Expected
        }
      }

      expect(service.getState('staleness-circuit')).toBe(CircuitState.OPEN);
    });

    it('should not trip on non-staleness errors until general threshold', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('other'));

      for (let i = 0; i < 4; i++) {
        try {
          await service.execute('non-staleness', fn, undefined, {
            isStalenessError: (error) => (error as Error).message === 'StalePriceFeed',
          });
        } catch (e) {
          // Expected
        }
      }

      // Should still be closed (threshold is 5)
      expect(service.getState('non-staleness')).toBe(CircuitState.CLOSED);
    });

    it('should reset staleness counter after success', async () => {
      const stalenessError = new Error('StalePriceFeed');
      const fn = jest.fn().mockRejectedValue(stalenessError);
      const successFn = jest.fn().mockResolvedValue('ok');

      // 2 staleness failures
      for (let i = 0; i < 2; i++) {
        try {
          await service.execute('staleness-reset', fn, undefined, {
            isStalenessError: (error) => (error as Error).message === 'StalePriceFeed',
          });
        } catch (e) {
          // Expected
        }
      }

      // Success resets staleness counter
      await service.execute('staleness-reset', successFn, undefined, {
        isStalenessError: (error) => (error as Error).message === 'StalePriceFeed',
      });

      // 2 more staleness failures should not trip (counter was reset)
      for (let i = 0; i < 2; i++) {
        try {
          await service.execute('staleness-reset', fn, undefined, {
            isStalenessError: (error) => (error as Error).message === 'StalePriceFeed',
          });
        } catch (e) {
          // Expected
        }
      }

      expect(service.getState('staleness-reset')).toBe(CircuitState.CLOSED);
    });
  });
});
