import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RateLimiterService, RateLimitType } from './rate-limiter.service';
import { RedisService } from './redis.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock Redis client whose sorted-set is backed by an in-memory Map. */
function buildMockRedisClient(
  initialEntries: Array<{ value: string; score: number }> = [],
) {
  // In-memory store: key → sorted entries
  const store = new Map<string, Array<{ value: string; score: number }>>();

  const getOrCreate = (key: string) => {
    if (!store.has(key)) store.set(key, [...initialEntries]);
    return store.get(key)!;
  };

  const clientMethods = {
    /**
     * Remove members whose score is inside [minScore, maxScore].
     * Passing '-inf' / '+inf' is handled as Number.NEGATIVE_INFINITY / POSITIVE_INFINITY.
     */
    zRemRangeByScore: jest.fn((key: string, min: string | number, max: string | number) => {
      const lo = min === '-inf' ? Number.NEGATIVE_INFINITY : Number(min);
      const hi = max === '+inf' ? Number.POSITIVE_INFINITY : Number(max);
      const arr = getOrCreate(key);
      const before = arr.length;
      const kept = arr.filter((e) => e.score < lo || e.score > hi);
      store.set(key, kept);
      return Promise.resolve(before - kept.length);
    }),

    /** Return entries with scores in [minScore, maxScore] (inclusive). */
    zRangeByScoreWithScores: jest.fn(
      (key: string, min: string | number, max: string | number) => {
        const lo = min === '-inf' ? Number.NEGATIVE_INFINITY : Number(min);
        const hi = max === '+inf' ? Number.POSITIVE_INFINITY : Number(max);
        const arr = getOrCreate(key);
        return Promise.resolve(
          arr.filter((e) => e.score >= lo && e.score <= hi),
        );
      },
    ),

    zAdd: jest.fn((key: string, entry: { score: number; value: string }) => {
      getOrCreate(key).push(entry);
      return Promise.resolve(1);
    }),

    expire: jest.fn().mockResolvedValue(1),

    /** Execute the same atomic contract as the production Lua script. */
    eval: jest.fn(
      async (
        _script: string,
        options: { keys: string[]; arguments: string[] },
      ): Promise<number[]> => {
        const key = options.keys[0];
        const now = Number(options.arguments[0]);
        const windowMs = Number(options.arguments[1]);
        const maxRequests = Number(options.arguments[2]);
        const windowStart = now - windowMs;

        await Promise.resolve(
          (clientMethods.zRemRangeByScore as jest.Mock)(
            key,
            '-inf',
            windowStart - 1,
          ),
        );
        const queriedEntries = await Promise.resolve(
          (clientMethods.zRangeByScoreWithScores as jest.Mock)(
            key,
            windowStart,
            '+inf',
          ),
        );
        const entries = queriedEntries.sort(
          (a: { score: number }, b: { score: number }) => a.score - b.score,
        );
        store.set(key, entries);

        if (entries.length < maxRequests) {
          await Promise.resolve(
            (clientMethods.zAdd as jest.Mock)(key, {
              score: now,
              value: options.arguments[4],
            }),
          );
          await Promise.resolve(
            (clientMethods.expire as jest.Mock)(key, Math.ceil(windowMs / 1000) + 1),
          );
          return [1, entries.length + 1, now + windowMs, 0];
        }

        return [0, entries.length, (entries[0]?.score ?? now) + windowMs, 1];
      },
    ),

    // Expose the in-memory store for assertions
    _store: store,
  };

  return clientMethods;
}

/** Build a ConfigService mock with explicit overrides. */
function buildConfigService(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    RATE_LIMIT_IP_REQUESTS: '5',
    RATE_LIMIT_IP_WINDOW_MS: '60000',
    RATE_LIMIT_USER_REQUESTS: '10',
    RATE_LIMIT_USER_WINDOW_MS: '60000',
    RATE_LIMIT_WALLET_REQUESTS: '3',
    RATE_LIMIT_WALLET_WINDOW_MS: '60000',
    RATE_LIMIT_OPERATION_REQUESTS: '2',
    RATE_LIMIT_OPERATION_WINDOW_MS: '60000',
    ...overrides,
  };
  return { get: jest.fn((key: string) => defaults[key]) };
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('RateLimiterService', () => {
  let service: RateLimiterService;
  let redisService: { getClient: jest.Mock };

  /**
   * Re-build the NestJS testing module with a fresh mock Redis client for
   * each test so state cannot bleed between tests.
   */
  async function buildModule(
    mockClient: ReturnType<typeof buildMockRedisClient>,
    configOverrides: Record<string, string> = {},
  ): Promise<void> {
    redisService = { getClient: jest.fn().mockReturnValue(mockClient) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimiterService,
        { provide: RedisService, useValue: redisService },
        { provide: ConfigService, useValue: buildConfigService(configOverrides) },
      ],
    }).compile();

    service = module.get<RateLimiterService>(RateLimiterService);
  }

  // ── Sliding-window correctness ──────────────────────────────────────────

  describe('sliding-window algorithm', () => {
    it('allows a request when the window is empty', async () => {
      await buildModule(buildMockRedisClient());
      const result = await service.checkLimit('192.0.2.1', 'ip');
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1);
    });

    it('blocks a request once the limit is reached within the window', async () => {
      // Pre-populate 5 entries (= IP limit) inside the window
      const now = Date.now();
      const entries = Array.from({ length: 5 }, (_, i) => ({
        value: `e${i}`,
        score: now - i * 100, // all recent, inside window
      }));
      await buildModule(buildMockRedisClient(entries));
      const result = await service.checkLimit('192.0.2.1', 'ip');
      expect(result.allowed).toBe(false);
      expect(result.current).toBe(5);
      expect(result.limit).toBe(5);
    });

    it('allows a request after stale entries have slid out of the window', async () => {
      // 5 entries, all older than the 60 s window → they will be pruned
      const now = Date.now();
      const staleEntries = Array.from({ length: 5 }, (_, i) => ({
        value: `old${i}`,
        score: now - 61_000 - i * 100, // 61 s+ ago – outside window
      }));
      const client = buildMockRedisClient(staleEntries);
      await buildModule(client);
      const result = await service.checkLimit('192.0.2.1', 'ip');
      expect(result.allowed).toBe(true);
    });

    it('prunes stale entries via zRemRangeByScore on every call', async () => {
      const client = buildMockRedisClient();
      await buildModule(client);
      await service.checkLimit('192.0.2.1', 'ip');
      expect(client.zRemRangeByScore).toHaveBeenCalledTimes(1);
      expect(client.zRemRangeByScore).toHaveBeenCalledWith(
        expect.stringContaining('rl:ip:'),
        '-inf',
        expect.any(Number),
      );
    });

    it('records a new entry via zAdd on an allowed request', async () => {
      const client = buildMockRedisClient();
      await buildModule(client);
      await service.checkLimit('192.0.2.1', 'ip');
      expect(client.zAdd).toHaveBeenCalledTimes(1);
      const call = client.zAdd.mock.calls[0];
      expect(call[0]).toBe('rl:ip:192.0.2.1');
      expect(typeof call[1].score).toBe('number');
    });

    it('evaluates pruning and reservation atomically in Redis', async () => {
      const client = buildMockRedisClient();
      await buildModule(client);
      await service.checkLimit('192.0.2.1', 'ip');

      expect(client.eval).toHaveBeenCalledWith(
        expect.stringContaining("ZREMRANGEBYSCORE"),
        expect.objectContaining({
          keys: ['rl:ip:192.0.2.1'],
          arguments: expect.arrayContaining(['60000', '5']),
        }),
      );
    });

    it('does NOT call zAdd when the limit is exceeded (no ghost writes)', async () => {
      const now = Date.now();
      const entries = Array.from({ length: 5 }, (_, i) => ({
        value: `e${i}`,
        score: now - i * 100,
      }));
      const client = buildMockRedisClient(entries);
      await buildModule(client);
      await service.checkLimit('192.0.2.1', 'ip');
      expect(client.zAdd).not.toHaveBeenCalled();
    });

    it('computes Retry-After from the oldest surviving entry', async () => {
      const now = Date.now();
      // Oldest entry is 30 s old → next slot opens in 30 s
      const entries = [
        { value: 'oldest', score: now - 30_000 },
        ...Array.from({ length: 4 }, (_, i) => ({
          value: `e${i}`,
          score: now - i * 100,
        })),
      ];
      const client = buildMockRedisClient(entries);
      await buildModule(client);
      const result = await service.checkLimit('192.0.2.1', 'ip');
      expect(result.allowed).toBe(false);
      // retryAfter should be ~30 s (±1 due to ceiling)
      expect(result.retryAfter).toBeGreaterThanOrEqual(29);
      expect(result.retryAfter).toBeLessThanOrEqual(31);
    });

    it('refreshes the TTL on every allowed request', async () => {
      const client = buildMockRedisClient();
      await buildModule(client);
      await service.checkLimit('192.0.2.1', 'ip');
      expect(client.expire).toHaveBeenCalledTimes(1);
    });

    it('reports correct resetAt timestamp', async () => {
      const client = buildMockRedisClient();
      await buildModule(client);
      const before = Date.now();
      const result = await service.checkLimit('192.0.2.1', 'ip');
      const after = Date.now();
      // resetAt should be approximately now + windowMs (60 000 ms)
      expect(result.resetAt).toBeGreaterThanOrEqual(before + 60_000);
      expect(result.resetAt).toBeLessThanOrEqual(after + 60_000);
    });
  });

  // ── Fail-open on Redis error ────────────────────────────────────────────

  describe('Redis error handling', () => {
    it('fails open (allows request) when Redis throws', async () => {
      const brokenClient = {
        zRemRangeByScore: jest.fn().mockRejectedValue(new Error('connection refused')),
        zRangeByScoreWithScores: jest.fn(),
        zAdd: jest.fn(),
        expire: jest.fn(),
      };
      redisService = { getClient: jest.fn().mockReturnValue(brokenClient) };

      const module = await Test.createTestingModule({
        providers: [
          RateLimiterService,
          { provide: RedisService, useValue: redisService },
          { provide: ConfigService, useValue: buildConfigService() },
        ],
      }).compile();

      service = module.get<RateLimiterService>(RateLimiterService);
      const result = await service.checkLimit('192.0.2.1', 'ip');
      expect(result.allowed).toBe(true);
    });
  });

  // ── Unknown type guard ──────────────────────────────────────────────────

  describe('type validation', () => {
    it('throws for an unknown rate limit type', async () => {
      await buildModule(buildMockRedisClient());
      await expect(
        service.checkLimit('test', 'unknown' as RateLimitType),
      ).rejects.toThrow('Unknown rate limit type: unknown');
    });
  });

  // ── Per-tier limit and key-prefix isolation ──────────────────────────────

  describe('IP tier', () => {
    it('returns correct limit for ip type', async () => {
      await buildModule(buildMockRedisClient());
      const result = await service.checkLimit('192.0.2.1', 'ip');
      expect(result.limit).toBe(5);
    });

    it('uses rl:ip: key prefix', async () => {
      const client = buildMockRedisClient();
      await buildModule(client);
      await service.checkLimit('192.0.2.1', 'ip');
      expect(client.zRemRangeByScore).toHaveBeenCalledWith(
        'rl:ip:192.0.2.1',
        expect.anything(),
        expect.anything(),
      );
    });

    it('blocks IP after exceeding the configured limit', async () => {
      const now = Date.now();
      const entries = Array.from({ length: 5 }, (_, i) => ({
        value: `ip${i}`,
        score: now - i * 50,
      }));
      const client = buildMockRedisClient(entries);
      await buildModule(client);
      const result = await service.checkLimit('10.0.0.1', 'ip');
      expect(result.allowed).toBe(false);
    });
  });

  describe('User tier', () => {
    it('returns correct limit for user type', async () => {
      await buildModule(buildMockRedisClient());
      const result = await service.checkLimit('user-abc', 'user');
      expect(result.limit).toBe(10);
    });

    it('uses rl:user: key prefix', async () => {
      const client = buildMockRedisClient();
      await buildModule(client);
      await service.checkLimit('user-abc', 'user');
      expect(client.zRemRangeByScore).toHaveBeenCalledWith(
        'rl:user:user-abc',
        expect.anything(),
        expect.anything(),
      );
    });

    it('blocks user after exceeding the configured limit', async () => {
      const now = Date.now();
      const entries = Array.from({ length: 10 }, (_, i) => ({
        value: `u${i}`,
        score: now - i * 50,
      }));
      const client = buildMockRedisClient(entries);
      await buildModule(client);
      const result = await service.checkLimit('user-abc', 'user');
      expect(result.allowed).toBe(false);
    });

    it('does not share quota across different user IDs', async () => {
      const client = buildMockRedisClient();
      await buildModule(client);
      // Two different users each make one request – both should be allowed
      const r1 = await service.checkLimit('user-1', 'user');
      const r2 = await service.checkLimit('user-2', 'user');
      expect(r1.allowed).toBe(true);
      expect(r2.allowed).toBe(true);
    });
  });

  describe('Wallet tier', () => {
    it('returns correct limit for wallet type', async () => {
      await buildModule(buildMockRedisClient());
      const result = await service.checkLimit('GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV7STMAQSMTGG', 'wallet');
      expect(result.limit).toBe(3);
    });

    it('uses rl:wallet: key prefix', async () => {
      const client = buildMockRedisClient();
      await buildModule(client);
      const walletAddress = 'GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV7STMAQSMTGG';
      await service.checkLimit(walletAddress, 'wallet');
      expect(client.zRemRangeByScore).toHaveBeenCalledWith(
        `rl:wallet:${walletAddress}`,
        expect.anything(),
        expect.anything(),
      );
    });

    it('blocks wallet after exceeding the configured limit', async () => {
      const now = Date.now();
      const entries = Array.from({ length: 3 }, (_, i) => ({
        value: `w${i}`,
        score: now - i * 100,
      }));
      const client = buildMockRedisClient(entries);
      await buildModule(client);
      const result = await service.checkLimit('GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV7STMAQSMTGG', 'wallet');
      expect(result.allowed).toBe(false);
    });

    it('does not share quota with user tier for the same identifier', async () => {
      const client = buildMockRedisClient();
      await buildModule(client);
      const id = 'GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV7STMAQSMTGG';
      const userResult = await service.checkLimit(id, 'user');
      const walletResult = await service.checkLimit(id, 'wallet');
      // Both are allowed; the quota is tracked independently per tier
      expect(userResult.allowed).toBe(true);
      expect(walletResult.allowed).toBe(true);
      // The keys used must differ
      const calls = client.zRemRangeByScore.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(calls[0]).not.toBe(calls[1]);
    });

    it('sets retryAfter correctly when wallet limit is exceeded', async () => {
      const now = Date.now();
      const entries = [
        { value: 'old', score: now - 45_000 }, // 45 s ago
        { value: 'mid', score: now - 20_000 },
        { value: 'new', score: now - 1_000 },
      ];
      const client = buildMockRedisClient(entries);
      await buildModule(client);
      const result = await service.checkLimit('GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV7STMAQSMTGG', 'wallet');
      expect(result.allowed).toBe(false);
      // Oldest score is 45 s ago; window is 60 s → retry in ~15 s
      expect(result.retryAfter).toBeGreaterThanOrEqual(14);
      expect(result.retryAfter).toBeLessThanOrEqual(16);
    });

    it('respects custom wallet window and limit from env', async () => {
      await buildModule(buildMockRedisClient(), {
        RATE_LIMIT_WALLET_REQUESTS: '50',
        RATE_LIMIT_WALLET_WINDOW_MS: '120000',
      });
      const result = await service.checkLimit('GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV7STMAQSMTGG', 'wallet');
      expect(result.limit).toBe(50);
    });
  });

  describe('Operation tier (legacy)', () => {
    it('returns correct limit for operation type', async () => {
      await buildModule(buildMockRedisClient());
      const result = await service.checkLimit('invoice-create', 'operation');
      expect(result.limit).toBe(2);
    });

    it('uses rl:op: key prefix', async () => {
      const client = buildMockRedisClient();
      await buildModule(client);
      await service.checkLimit('invoice-create', 'operation');
      expect(client.zRemRangeByScore).toHaveBeenCalledWith(
        'rl:op:invoice-create',
        expect.anything(),
        expect.anything(),
      );
    });
  });

  // ── Tier isolation: separate counters for same identifier ────────────────

  describe('tier isolation', () => {
    it('IP, user, and wallet counters for the same identifier are independent', async () => {
      const client = buildMockRedisClient();
      await buildModule(client);
      const id = 'shared-id';

      await service.checkLimit(id, 'ip');
      await service.checkLimit(id, 'user');
      await service.checkLimit(id, 'wallet');

      const keys = client.zRemRangeByScore.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(new Set(keys).size).toBe(3); // three distinct Redis keys
    });
  });

  // ── Counter increment ───────────────────────────────────────────────────

  describe('counter increment', () => {
    it('current count increases on each allowed request for the same key', async () => {
      const client = buildMockRedisClient();
      await buildModule(client);

      const r1 = await service.checkLimit('user-seq', 'user');
      // Simulate the second call seeing the entry added by the first call
      // by having zRangeByScoreWithScores return one entry on the next call
      client.zRangeByScoreWithScores.mockResolvedValueOnce([
        { value: 'prev', score: Date.now() },
      ]);
      const r2 = await service.checkLimit('user-seq', 'user');

      expect(r1.current).toBe(1);
      expect(r2.current).toBe(2);
    });
  });
});
