import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RateLimiterService } from './rate-limiter.service';
import { RedisService } from './redis.service';

describe('RateLimiterService', () => {
  let service: RateLimiterService;
  let redisService: RedisService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimiterService,
        {
          provide: RedisService,
          useValue: {
            getClient: jest.fn().mockReturnValue({
              zRangeByScore: jest.fn().mockResolvedValue([]),
              zAdd: jest.fn().mockResolvedValue(1),
              expire: jest.fn().mockResolvedValue(1),
            }),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key) => {
              const defaults: Record<string, string> = {
                RATE_LIMIT_IP_REQUESTS: '100',
                RATE_LIMIT_IP_WINDOW_MS: '60000',
                RATE_LIMIT_USER_REQUESTS: '1000',
                RATE_LIMIT_USER_WINDOW_MS: '60000',
                RATE_LIMIT_OPERATION_REQUESTS: '10',
                RATE_LIMIT_OPERATION_WINDOW_MS: '60000',
              };
              return defaults[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<RateLimiterService>(RateLimiterService);
    redisService = module.get<RedisService>(RedisService);
  });

  describe('checkLimit', () => {
    it('should allow request when under limit', async () => {
      const result = await service.checkLimit('test-ip', 'ip');

      expect(result.allowed).toBe(true);
      expect(result.current).toBeGreaterThan(0);
      expect(result.limit).toBeGreaterThan(0);
    });

    it('should set Retry-After when limit exceeded', async () => {
      const mockClient = {
        zRangeByScore: jest.fn().mockResolvedValue(
          Array(100).fill('entry'), // 100 entries = at IP limit
        ),
        zAdd: jest.fn().mockResolvedValue(1),
        expire: jest.fn().mockResolvedValue(1),
      };

      jest.spyOn(redisService, 'getClient').mockReturnValue(mockClient as any);

      const result = await service.checkLimit('test-ip', 'ip');

      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('should increment count on successful request', async () => {
      const mockClient = {
        zRangeByScore: jest.fn().mockResolvedValue([]),
        zAdd: jest.fn().mockResolvedValue(1),
        expire: jest.fn().mockResolvedValue(1),
      };

      jest.spyOn(redisService, 'getClient').mockReturnValue(mockClient as any);

      const result1 = await service.checkLimit('user-1', 'user');
      const result2 = await service.checkLimit('user-1', 'user');

      expect(result1.current).toBeLessThan(result2.current);
    });

    it('should handle different rate limit types', async () => {
      const mockClient = {
        zRangeByScore: jest.fn().mockResolvedValue([]),
        zAdd: jest.fn().mockResolvedValue(1),
        expire: jest.fn().mockResolvedValue(1),
      };

      jest.spyOn(redisService, 'getClient').mockReturnValue(mockClient as any);

      const ipResult = await service.checkLimit('192.168.1.1', 'ip');
      const userResult = await service.checkLimit('user-123', 'user');
      const opResult = await service.checkLimit('invoice-create', 'operation');

      expect(ipResult.limit).toBe(100);
      expect(userResult.limit).toBe(1000);
      expect(opResult.limit).toBe(10);
    });
  });
});
