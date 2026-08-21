import { Injectable, NestMiddleware, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { RateLimiterService, RateLimitType, RateLimitResult } from './rate-limiter.service';
import { ConfigService } from '@nestjs/config';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      walletAddress?: string;
    }
  }
}

/**
 * Soroban-mutating endpoints that carry per-wallet rate limits.
 * These paths execute on-chain transactions and must be independently
 * throttled to prevent a single wallet from exhausting contract resources.
 */
const WALLET_ENDPOINTS: Array<{ method: string; path: string }> = [
  { method: 'POST', path: '/api/financing-pool/fund' },
  { method: 'POST', path: '/api/settlement/settle' },
];

/**
 * RateLimitMiddleware enforces three independent sliding-window counters
 * in a single pass.  All three checks run for every request; the first
 * counter that exceeds its limit causes an immediate 429.
 *
 * Counter precedence (highest → lowest):
 *   1. Wallet  – POST /financing-pool/fund and POST /settlement/settle only
 *   2. User    – any request that carries a resolved userId
 *   3. IP      – fallback for unauthenticated / unresolved requests
 *
 * The wallet and user counters are checked on top of (not instead of) the
 * IP counter so that a wallet/user burst cannot also exhaust the shared IP
 * quota from behind a proxy.
 */
@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private logger = new Logger(RateLimitMiddleware.name);
  private enableRateLimit: boolean;

  constructor(
    private rateLimiter: RateLimiterService,
    private config: ConfigService,
  ) {
    this.enableRateLimit = this.config.get('ENABLE_RATE_LIMITING') !== 'false';
  }

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!this.enableRateLimit) return next();

    const clientIp = this.getClientIp(req);
    const userId = req.userId;
    const walletAddress = req.walletAddress;
    const isWalletEndpoint = this.isWalletEndpoint(req);

    try {
      // ── Tier 1: per-IP (always checked) ─────────────────────────────────
      const ipResult = await this.rateLimiter.checkLimit(clientIp, 'ip');
      this.applyHeaders(res, 'ip', ipResult);
      if (!ipResult.allowed) {
        this.reject(res, ipResult, 'IP');
        return;
      }

      // ── Tier 2: per-user (authenticated requests only) ───────────────────
      if (userId) {
        const userResult = await this.rateLimiter.checkLimit(userId, 'user');
        this.applyHeaders(res, 'user', userResult);
        if (!userResult.allowed) {
          this.reject(res, userResult, 'user');
          return;
        }
      }

      // ── Tier 3: per-wallet (Soroban-mutating endpoints only) ─────────────
      if (isWalletEndpoint && walletAddress) {
        const walletResult = await this.rateLimiter.checkLimit(walletAddress, 'wallet');
        this.applyHeaders(res, 'wallet', walletResult);
        if (!walletResult.allowed) {
          this.reject(res, walletResult, 'wallet');
          return;
        }
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Fail-open: a Redis error should not block legitimate traffic.
      this.logger.warn(`Rate limit check failed for ${clientIp}: ${(error as Error)?.message}`);
    }

    next();
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Write X-RateLimit-* headers scoped to the given tier so clients can
   * track consumption across all three counters simultaneously.
   *
   * Header naming convention:
   *   X-RateLimit-<Tier>-Limit      – maximum requests in the window
   *   X-RateLimit-<Tier>-Remaining  – requests remaining this window
   *   X-RateLimit-<Tier>-Reset      – window reset time (Unix seconds)
   */
  private applyHeaders(res: Response, tier: RateLimitType, result: RateLimitResult): void {
    const prefix = `X-RateLimit-${this.capitalize(tier)}`;
    res.setHeader(`${prefix}-Limit`, result.limit);
    res.setHeader(`${prefix}-Remaining`, Math.max(0, result.limit - result.current));
    res.setHeader(`${prefix}-Reset`, Math.ceil(result.resetAt / 1000));
  }

  /**
   * Emit a 429 Too Many Requests response with:
   *   - Retry-After (seconds until next slot opens)
   *   - X-RateLimit-Tier to tell the client which counter triggered
   */
  private reject(res: Response, result: RateLimitResult, tier: string): never {
    const retryAfter = result.retryAfter ?? 60;
    res.setHeader('Retry-After', retryAfter.toString());
    res.setHeader('X-RateLimit-Tier', tier);
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
        message: `${tier} rate limit exceeded. Retry after ${retryAfter} second${retryAfter === 1 ? '' : 's'}.`,
        retryAfter,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /**
   * Extract the real client IP from X-Forwarded-For (set by a trusted
   * reverse proxy) or fall back to the raw socket address.
   * Only the first (leftmost) address in X-Forwarded-For is used because
   * that is the original client; subsequent addresses are proxies.
   */
  private getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unknown';
  }

  /** Return true when the request targets a Soroban-mutating endpoint. */
  private isWalletEndpoint(req: Request): boolean {
    return WALLET_ENDPOINTS.some(
      (e) => e.method === req.method && req.path.startsWith(e.path),
    );
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}
