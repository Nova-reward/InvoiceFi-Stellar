import { isAdmin, principalFromPayload } from './principal';

describe('principalFromPayload', () => {
  it('normalizes role to lowercase and stringifies sub', () => {
    const principal = principalFromPayload({
      sub: 42,
      walletAddress: 'GABC',
      role: 'ADMIN',
    });
    expect(principal).toEqual({
      userId: '42',
      walletAddress: 'GABC',
      role: 'admin',
    });
    expect(isAdmin(principal)).toBe(true);
  });

  it('is not admin for other roles', () => {
    const principal = principalFromPayload({
      sub: 1,
      walletAddress: 'GABC',
      role: 'investor',
    });
    expect(isAdmin(principal)).toBe(false);
  });

  it('throws when identity claims are missing', () => {
    expect(() =>
      principalFromPayload({ walletAddress: 'GABC', role: 'admin' }),
    ).toThrow();
    expect(() =>
      principalFromPayload({ sub: 1, role: 'admin' }),
    ).toThrow();
    expect(() =>
      principalFromPayload({ sub: 1, walletAddress: 'GABC' }),
    ).toThrow();
  });
});
