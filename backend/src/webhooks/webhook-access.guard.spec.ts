import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { signHs256Jwt } from '../compliance/jwt';
import { WebhookAccessGuard } from './webhook-access.guard';

const SECRET = 'guard-secret';

function makeContext(headers: Record<string, string>): ExecutionContext {
  const req: any = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function makeGuard(): WebhookAccessGuard {
  const config = { get: () => SECRET } as unknown as ConfigService;
  return new WebhookAccessGuard(config);
}

const token = signHs256Jwt({ sub: 1, walletAddress: 'GFARMER', role: 'farmer' }, SECRET);

describe('WebhookAccessGuard', () => {
  it('authenticates from the Authorization header and attaches the principal', () => {
    const guard = makeGuard();
    const ctx = makeContext({ authorization: `Bearer ${token}` });

    expect(guard.canActivate(ctx)).toBe(true);
    expect(ctx.switchToHttp().getRequest<any>().principal).toEqual({
      userId: '1',
      walletAddress: 'GFARMER',
      role: 'farmer',
    });
  });

  it('authenticates from the token cookie', () => {
    const guard = makeGuard();
    const ctx = makeContext({ cookie: `token=${token}` });

    expect(guard.canActivate(ctx)).toBe(true);
    expect(ctx.switchToHttp().getRequest<any>().principal.walletAddress).toBe('GFARMER');
  });

  it('rejects a request with no token', () => {
    const guard = makeGuard();
    expect(() => guard.canActivate(makeContext({}))).toThrow(UnauthorizedException);
  });

  it('rejects a token signed with the wrong secret', () => {
    const guard = makeGuard();
    const bad = signHs256Jwt({ sub: 1, walletAddress: 'GFARMER', role: 'farmer' }, 'wrong');
    expect(() => guard.canActivate(makeContext({ authorization: `Bearer ${bad}` }))).toThrow(
      UnauthorizedException,
    );
  });
});
