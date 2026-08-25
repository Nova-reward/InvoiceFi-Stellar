import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ComplianceAccessGuard } from './compliance-access.guard';
import { signHs256Jwt } from './jwt';

const SECRET = 'guard-secret';

function makeContext(headers: Record<string, string>): ExecutionContext {
  const req: any = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function makeGuard(): ComplianceAccessGuard {
  const config = { get: () => SECRET } as unknown as ConfigService;
  return new ComplianceAccessGuard(config);
}

const token = signHs256Jwt(
  { sub: 1, walletAddress: 'GABC', role: 'admin' },
  SECRET,
);

describe('ComplianceAccessGuard', () => {
  it('authenticates from the Authorization header and attaches the principal', () => {
    const guard = makeGuard();
    const ctx = makeContext({ authorization: `Bearer ${token}` });

    expect(guard.canActivate(ctx)).toBe(true);
    const req = ctx.switchToHttp().getRequest<any>();
    expect(req.principal).toEqual({
      userId: '1',
      walletAddress: 'GABC',
      role: 'admin',
    });
  });

  it('authenticates from the token cookie', () => {
    const guard = makeGuard();
    const ctx = makeContext({ cookie: `foo=bar; token=${token}` });

    expect(guard.canActivate(ctx)).toBe(true);
    expect(ctx.switchToHttp().getRequest<any>().principal.role).toBe('admin');
  });

  it('rejects a request with no token', () => {
    const guard = makeGuard();
    expect(() => guard.canActivate(makeContext({}))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token signed with the wrong secret', () => {
    const guard = makeGuard();
    const bad = signHs256Jwt(
      { sub: 1, walletAddress: 'GABC', role: 'admin' },
      'wrong',
    );
    expect(() =>
      guard.canActivate(makeContext({ authorization: `Bearer ${bad}` })),
    ).toThrow(UnauthorizedException);
  });
});
