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

/**
 * The complete check is evaluated by Redis as one atomic operation. This is
 * important under load: a client-side sequence of ZCOUNT/ZADD commands has a
 * race between reading the count and reserving the slot, allowing concurrent
 * requests to exceed the configured limit.
 */
const SLIDING_WINDOW_SCRIPT = `
local now = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local max_requests = tonumber(ARGV[3])
local ttl_seconds = tonumber(ARGV[4])
local member = ARGV[5]
local window_start = now - window_ms

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', window_start - 1)
local current = redis.call('ZCOUNT', KEYS[1], window_start, now)

if current < max_requests then
  redis.call('ZADD', KEYS[1], now, member)
  redis.call('EXPIRE', KEYS[1], ttl_seconds)
  return { 1, current + 1, now + window_ms, 0 }
end

local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local oldest_score = tonumber(oldest[2]) or now
return { 0, current, oldest_score + window_ms, 1 }
`;

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
   * Sliding-window rate-limit check using an atomic Redis sorted-set script.
   *
   * Algorithm (O(log N + M) per call, where N = total entries in the set
   * and M = number of expired entries pruned this call):
   *
   *  1. Compute the window boundary: windowStart = now - windowMs.
   *  2. The Lua script atomically runs ZREMRANGEBYSCORE, ZCOUNT, and ZADD.
   *     This keeps the set bounded to the active window and prevents races
   *     between concurrent requests.
   *  3. If count < limit, the script reserves a unique member and refreshes
   *     the key TTL; otherwise it reads the oldest score for Retry-After.
   *  4. The result contains the current count and the exact reset timestamp.
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
    const redisClient = this.redis.getClient();

    try {
      // The Lua script prunes, counts, reserves, and sets the TTL atomically.
      // A random suffix makes simultaneous requests distinct even when their
      // millisecond timestamps are identical.
      const member = `${now}-${Math.random().toString(36).slice(2)}`;
      const rawResult = (await redisClient.eval(SLIDING_WINDOW_SCRIPT, {
        keys: [key],
        arguments: [
          String(now),
          String(cfg.windowMs),
          String(cfg.maxRequests),
          String(Math.ceil(cfg.windowMs / 1000) + 1),
          member,
        ],
      })) as Array<number | string>;

      const allowed = Number(rawResult[0]) === 1;
      const current = Number(rawResult[1]);
      const resetAt = Number(rawResult[2]);
      const retryAfterMs = resetAt - now;

      return {
        allowed,
        current,
        limit: cfg.maxRequests,
        resetAt,
        ...(allowed
          ? {}
          : { retryAfter: Math.max(1, Math.ceil(retryAfterMs / 1000)) }),
      };
    } catch (error) {
      this.logger.error(`Rate limit check failed for ${key}`, error);
      // Fail-open: allow the request so a Redis outage does not take the API down.
      return { allowed: true, current: 0, limit: cfg.maxRequests, resetAt: now };
    }
  }
}
