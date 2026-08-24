import {
  Injectable,
  NestMiddleware,
  HttpException,
  HttpStatus,
  Logger,
  Optional,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request, Response, NextFunction } from 'express';
import { RateLimiterService, RateLimitType, RateLimitResult } from './rate-limiter.service';
import { ConfigService } from '@nestjs/config';
import { VaultService } from '../config/vault/vault.service';

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
  { method: 'POST', path: '/financing-pool/fund' },
  { method: 'POST', path: '/settlement/settle' },
];

interface AuthenticatedRequestUser {
  userId?: string;
  walletAddress?: string;
}

interface JwtRateLimitPayload {
  sub?: string;
  walletAddress?: string;
}

/**
 * RateLimitMiddleware enforces three independent sliding-window counters
 * in a single pass. Anonymous requests use the IP counter, authenticated
 * requests use the user counter, and matching mutation routes add a wallet
 * counter. The first applicable counter that exceeds its limit causes 429.
 *
 * Counter precedence (highest → lowest):
 *   1. Wallet  – POST /financing-pool/fund and POST /settlement/settle only
 *   2. User    – any request that carries a resolved userId
 *   3. IP      – fallback for unauthenticated / unresolved requests
 *
 * The IP and user counters are independent keys; wallet checks are added to
 * authenticated mutation requests without sharing quota with either tier.
 */
@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private logger = new Logger(RateLimitMiddleware.name);
  private enableRateLimit: boolean;

  constructor(
    private rateLimiter: RateLimiterService,
    private config: ConfigService,
    @Optional() private jwtService?: JwtService,
    @Optional() private vault?: VaultService,
  ) {
    this.enableRateLimit = this.config.get('ENABLE_RATE_LIMITING') !== 'false';
  }

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!this.enableRateLimit) return next();

    const clientIp = this.getClientIp(req);
    const { userId, walletAddress } = this.resolveIdentity(req);
    const isWalletEndpoint = this.isWalletEndpoint(req);

    try {
      // ── Tier 1: anonymous per-IP / authenticated per-user ────────────────
      // These are mutually exclusive tiers: authenticated traffic is keyed
      // by its verified user ID, while anonymous traffic is keyed by IP.
      if (userId) {
        const userResult = await this.rateLimiter.checkLimit(userId, 'user');
        this.applyHeaders(res, 'user', userResult);
        if (!userResult.allowed) {
          this.reject(res, userResult, 'user');
          return;
        }
      } else {
        const ipResult = await this.rateLimiter.checkLimit(clientIp, 'ip');
        this.applyHeaders(res, 'ip', ipResult);
        if (!ipResult.allowed) {
          this.reject(res, ipResult, 'IP');
          return;
        }
      }

      // ── Tier 2: per-wallet (Soroban-mutating endpoints only) ─────────────
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
    const retryAfter =
      result.retryAfter ?? Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
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

  /**
   * Resolve identity after authentication has already populated req.user, or
   * verify the bearer token here because Nest middleware runs before guards.
   * Invalid/missing credentials deliberately fall back to the IP tier; the
   * authentication guard remains responsible for returning 401.
   */
  private resolveIdentity(req: Request): AuthenticatedRequestUser {
    const requestUser = (req as Request & { user?: AuthenticatedRequestUser }).user;
    let userId = req.userId ?? requestUser?.userId;
    let walletAddress = req.walletAddress ?? requestUser?.walletAddress;

    const token = this.getBearerToken(req);
    if ((!userId || !walletAddress) && token && this.jwtService && this.vault) {
      try {
        const payload = this.jwtService.verify<JwtRateLimitPayload>(token, {
          secret: this.vault.auth.jwt_secret,
        });
        userId ??= payload.sub;
        walletAddress ??= payload.walletAddress;
      } catch {
        // Do not turn an invalid token into a rate-limit error. The auth guard
        // will reject it after this middleware has applied the IP tier.
      }
    }

    return { userId, walletAddress };
  }

  private getBearerToken(req: Request): string | undefined {
    const authorization = req.headers.authorization;
    if (typeof authorization !== 'string') return undefined;
    const [scheme, token] = authorization.split(' ');
    return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
  }

  /** Return true when the request targets a Soroban-mutating endpoint. */
  private isWalletEndpoint(req: Request): boolean {
    // Support deployments with and without the optional /api prefix.
    const path = req.path.replace(/^\/api(?=\/|$)/, '');
    return WALLET_ENDPOINTS.some(
      (e) =>
        e.method === req.method &&
        (path === e.path || path.startsWith(`${e.path}/`)),
    );
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}
