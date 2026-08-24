import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import {
  RateLimitResult,
  RateLimiterService,
} from './rate-limiter.service';
import { RateLimitMiddleware } from './rate-limit.middleware';

function request(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    path: '/health',
    headers: {},
    socket: { remoteAddress: '192.0.2.10' },
    ...overrides,
  } as Request;
}

function response() {
  return { setHeader: jest.fn() } as unknown as Response;
}

function allowedResult(limit = 10): RateLimitResult {
  return {
    allowed: true,
    current: 1,
    limit,
    resetAt: Date.now() + 60_000,
  };
}

describe('RateLimitMiddleware', () => {
  it('uses the IP tier for anonymous requests and the user tier for authenticated requests', async () => {
    const checkLimit = jest.fn().mockResolvedValue(allowedResult());
    const middleware = new RateLimitMiddleware(
      { checkLimit } as unknown as RateLimiterService,
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
    );
    const next = jest.fn();

    await middleware.use(request(), response(), next);
    await middleware.use(
      request({ user: { userId: 'user-42' } } as Partial<Request>),
      response(),
      next,
    );

    expect(checkLimit).toHaveBeenNthCalledWith(1, '192.0.2.10', 'ip');
    expect(checkLimit).toHaveBeenNthCalledWith(2, 'user-42', 'user');
    expect(checkLimit).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('checks the wallet counter for both API-prefixed and unprefixed mutation paths', async () => {
    const checkLimit = jest.fn().mockResolvedValue(allowedResult());
    const middleware = new RateLimitMiddleware(
      { checkLimit } as unknown as RateLimiterService,
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
    );

    await middleware.use(
      request({
        method: 'POST',
        path: '/api/financing-pool/fund',
        user: { userId: 'user-42', walletAddress: 'GABC' },
      } as Partial<Request>),
      response(),
      jest.fn(),
    );

    expect(checkLimit).toHaveBeenNthCalledWith(1, 'user-42', 'user');
    expect(checkLimit).toHaveBeenNthCalledWith(2, 'GABC', 'wallet');
  });

  it('sets Retry-After and identifies the tier on a 429 response', async () => {
    const limited: RateLimitResult = {
      allowed: false,
      current: 3,
      limit: 3,
      resetAt: Date.now() + 15_000,
      retryAfter: 15,
    };
    const checkLimit = jest
      .fn()
      .mockResolvedValueOnce(allowedResult())
      .mockResolvedValueOnce(limited);
    const res = response();
    const middleware = new RateLimitMiddleware(
      { checkLimit } as unknown as RateLimiterService,
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
    );

    let thrown: unknown;
    try {
      await middleware.use(
        request({
          method: 'POST',
          path: '/settlement/settle',
          user: { userId: 'user-42', walletAddress: 'GABC' },
        } as Partial<Request>),
        res,
        jest.fn(),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '15');
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Tier', 'wallet');
  });
});
