import { Injectable, NestMiddleware, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { RateLimiterService } from './rate-limiter.service';
import { ConfigService } from '@nestjs/config';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private logger = new Logger(RateLimitMiddleware.name);
  private enableRateLimit: boolean;
  private unauthenticatedEndpoints: string[];

  constructor(private rateLimiter: RateLimiterService, private config: ConfigService) {
    this.enableRateLimit = this.config.get('ENABLE_RATE_LIMITING') !== 'false';
    this.unauthenticatedEndpoints = ['/health', '/api/auth/login', '/api/auth/register'];
  }

  async use(req: Request, res: Response, next: NextFunction) {
    if (!this.enableRateLimit) return next();

    const isUnauthenticated = !req.userId && this.isPublicEndpoint(req.path);
    const identifier = isUnauthenticated ? this.getClientIp(req) : req.userId || this.getClientIp(req);
    const limitType = isUnauthenticated ? 'ip' : 'user';

    try {
      const result = await this.rateLimiter.checkLimit(identifier, limitType);

      res.setHeader('X-RateLimit-Limit', result.limit);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, result.limit - result.current));
      res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));

      if (!result.allowed) {
        res.setHeader('Retry-After', result.retryAfter?.toString() || '60');
        throw new HttpException(
          `Rate limit exceeded. Retry after ${result.retryAfter} seconds.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.warn(`Rate limit check failed: ${(error as any)?.message}`);
    }

    next();
  }

  private getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unknown';
  }

  private isPublicEndpoint(path: string): boolean {
    return this.unauthenticatedEndpoints.some((endpoint) => path.startsWith(endpoint));
  }
}
