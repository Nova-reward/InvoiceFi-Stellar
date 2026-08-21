import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}

export interface RateLimitResult {
  allowed: boolean;
  current: number;
  limit: number;
  resetAt: number;
  retryAfter?: number;
}

/**
 * Rate limit types supported by the service.
 *
 * - 'ip'        : anonymous / unauthenticated callers, keyed by client IP
 * - 'user'      : authenticated callers, keyed by user-ID JWT sub claim
 * - 'wallet'    : Soroban-mutating endpoints, keyed by Stellar wallet address
 * - 'operation' : legacy alias kept for backwards-compatibility
 */
export type RateLimitType = 'ip' | 'user' | 'wallet' | 'operation';

@Injectable()
export class RateLimiterService {
  private logger = new Logger(RateLimiterService.name);
  private config: Map<string, RateLimitConfig> = new Map();

  constructor(private redis: RedisService, private configService: ConfigService) {
    this.initializeConfigs();
  }

  private initializeConfigs(): void {
    const ipLimit = this.configService.get('RATE_LIMIT_IP_REQUESTS') || '100';
    const ipWindow = this.configService.get('RATE_LIMIT_IP_WINDOW_MS') || '60000';
    const userLimit = this.configService.get('RATE_LIMIT_USER_REQUESTS') || '1000';
    const userWindow = this.configService.get('RATE_LIMIT_USER_WINDOW_MS') || '60000';
    const walletLimit = this.configService.get('RATE_LIMIT_WALLET_REQUESTS') || '30';
    const walletWindow = this.configService.get('RATE_LIMIT_WALLET_WINDOW_MS') || '60000';
    const operationLimit = this.configService.get('RATE_LIMIT_OPERATION_REQUESTS') || '10';
    const operationWindow = this.configService.get('RATE_LIMIT_OPERATION_WINDOW_MS') || '60000';

    this.config.set('ip', {
      windowMs: Number(ipWindow),
      maxRequests: Number(ipLimit),
      keyPrefix: 'rl:ip:',
    });

    this.config.set('user', {
      windowMs: Number(userWindow),
      maxRequests: Number(userLimit),
      keyPrefix: 'rl:user:',
    });

    this.config.set('wallet', {
      windowMs: Number(walletWindow),
      maxRequests: Number(walletLimit),
      keyPrefix: 'rl:wallet:',
    });

    this.config.set('operation', {
      windowMs: Number(operationWindow),
      maxRequests: Number(operationLimit),
      keyPrefix: 'rl:op:',
    });
  }

  /**
   * Sliding-window rate-limit check using a Redis sorted set.
   *
   * Algorithm (O(log N + M) per call, where N = total entries in the set
   * and M = number of expired entries pruned this call):
   *
   *  1. Compute the window boundary: windowStart = now - windowMs.
   *  2. ZREMRANGEBYSCORE  – atomically remove all members whose score
   *     (Unix-ms timestamp) is older than windowStart.  This keeps the
   *     set bounded to the active window only.
   *  3. ZRANGEBYSCORE with WITHSCORES – count the members that remain
   *     inside [windowStart, now].  Because we just pruned stale entries
   *     the count is the current sliding-window count.
   *  4. If count < limit  → ZADD a new member scored at `now` and refresh
   *     the key TTL.  Return allowed=true.
   *  5. If count >= limit → read the lowest score (oldest surviving
   *     entry) to compute the precise Retry-After value.  Return
   *     allowed=false without adding a new entry.
   *
   * Why sorted sets instead of a fixed-window counter?
   *   Fixed windows allow a burst of 2× the limit across a window boundary
   *   (all quota in the last second of window N + all quota in the first
   *   second of window N+1).  The sorted-set approach enforces a true
   *   rolling window: at any point in time the count of events within the
   *   past `windowMs` milliseconds never exceeds `maxRequests`.
   *
   * Space complexity: O(maxRequests) per identifier – expired entries are
   * pruned on every call so the set never grows beyond the window's worth
   * of events.
   */
  async checkLimit(identifier: string, type: RateLimitType): Promise<RateLimitResult> {
    const cfg = this.config.get(type);
    if (!cfg) throw new Error(`Unknown rate limit type: ${type}`);

    const key = cfg.keyPrefix + identifier;
    const now = Date.now();
    const windowStart = now - cfg.windowMs;
    const redisClient = this.redis.getClient();

    try {
      // Step 1 – prune entries that have slid out of the window.
      await redisClient.zRemRangeByScore(key, '-inf', windowStart - 1);

      // Step 2 – count (and retrieve scores of) entries still in the window.
      // zRangeByScoreWithScores returns Array<{ value: string; score: number }>
      // so we get the actual numeric timestamps rather than the opaque value strings.
      const entries = await redisClient.zRangeByScoreWithScores(key, windowStart, '+inf');
      const currentCount = entries.length;

      if (currentCount < cfg.maxRequests) {
        // Unique member value prevents score collisions for simultaneous requests.
        await redisClient.zAdd(key, {
          score: now,
          value: `${now}-${Math.random().toString(36).slice(2)}`,
        });
        // TTL = one full window + 1 s buffer so Redis can GC the key automatically.
        await redisClient.expire(key, Math.ceil(cfg.windowMs / 1000) + 1);

        return {
          allowed: true,
          current: currentCount + 1,
          limit: cfg.maxRequests,
          resetAt: now + cfg.windowMs,
        };
      }

      // Limit exceeded – the earliest surviving entry tells us when a slot
      // opens up again: retryAfter = (oldestTimestamp + windowMs) - now.
      const oldestScore = entries[0]?.score ?? now;
      const retryAfterMs = oldestScore + cfg.windowMs - now;
      const retryAfter = Math.max(1, Math.ceil(retryAfterMs / 1000));

      return {
        allowed: false,
        current: currentCount,
        limit: cfg.maxRequests,
        resetAt: oldestScore + cfg.windowMs,
        retryAfter,
      };
    } catch (error) {
      this.logger.error(`Rate limit check failed for ${key}`, error);
      // Fail-open: allow the request so a Redis outage does not take the API down.
      return { allowed: true, current: 0, limit: cfg.maxRequests, resetAt: now };
    }
  }
}
