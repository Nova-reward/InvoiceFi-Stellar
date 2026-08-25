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

    this.config.set('operation', {
      windowMs: Number(operationWindow),
      maxRequests: Number(operationLimit),
      keyPrefix: 'rl:op:',
    });
  }

  async checkLimit(identifier: string, type: 'ip' | 'user' | 'operation'): Promise<RateLimitResult> {
    const cfg = this.config.get(type);
    if (!cfg) throw new Error(`Unknown rate limit type: ${type}`);

    const key = cfg.keyPrefix + identifier;
    const now = Date.now();
    const windowStart = now - cfg.windowMs;
    const redisClient = this.redis.getClient();

    try {
      const timestamps = await redisClient.zRangeByScore(key, windowStart, now);
      const currentCount = timestamps ? timestamps.length : 0;

      if (currentCount < cfg.maxRequests) {
        await redisClient.zAdd(key, { score: now, value: `${now}-${Math.random()}` });
        await redisClient.expire(key, Math.ceil(cfg.windowMs / 1000) + 1);

        return {
          allowed: true,
          current: currentCount + 1,
          limit: cfg.maxRequests,
          resetAt: now + cfg.windowMs,
        };
      }

      const oldestTimestamp = timestamps && timestamps.length > 0 ? Number(timestamps[0]) : now;
      const retryAfter = Math.ceil((oldestTimestamp + cfg.windowMs - now) / 1000);
      return {
        allowed: false,
        current: currentCount,
        limit: cfg.maxRequests,
        resetAt: now + cfg.windowMs,
        retryAfter,
      };
    } catch (error) {
      this.logger.error(`Rate limit check failed for ${key}`, error);
      return { allowed: true, current: 0, limit: cfg.maxRequests, resetAt: now };
    }
  }
}
