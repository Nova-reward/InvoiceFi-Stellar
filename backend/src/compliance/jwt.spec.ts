import {
  JwtVerificationError,
  signHs256Jwt,
  verifyHs256Jwt,
} from './jwt';

const SECRET = 'test-secret';

describe('verifyHs256Jwt', () => {
  it('verifies a valid token and returns its payload', () => {
    const token = signHs256Jwt(
      { sub: 42, walletAddress: 'GABC', role: 'admin' },
      SECRET,
    );
    const payload = verifyHs256Jwt(token, SECRET);
    expect(payload.sub).toBe(42);
    expect(payload.walletAddress).toBe('GABC');
    expect(payload.role).toBe('admin');
  });

  it('rejects a token signed with a different secret', () => {
    const token = signHs256Jwt({ sub: 1 }, 'other-secret');
    expect(() => verifyHs256Jwt(token, SECRET)).toThrow(JwtVerificationError);
  });

  it('rejects a malformed token', () => {
    expect(() => verifyHs256Jwt('not.a.jwt.token', SECRET)).toThrow(
      JwtVerificationError,
    );
    expect(() => verifyHs256Jwt('onlyonepart', SECRET)).toThrow(
      JwtVerificationError,
    );
  });

  it('rejects a non-HS256 algorithm (alg confusion guard)', () => {
    const header = Buffer.from(
      JSON.stringify({ alg: 'none', typ: 'JWT' }),
    ).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: 1 })).toString('base64url');
    const forged = `${header}.${body}.`;
    expect(() => verifyHs256Jwt(forged, SECRET)).toThrow(JwtVerificationError);
  });

  it('rejects an expired token', () => {
    const token = signHs256Jwt({ sub: 1, exp: 1000 }, SECRET);
    expect(() => verifyHs256Jwt(token, SECRET, 2000)).toThrow('expired');
  });

  it('accepts a token that has not yet expired', () => {
    const token = signHs256Jwt({ sub: 1, exp: 5000 }, SECRET);
    expect(verifyHs256Jwt(token, SECRET, 1000).sub).toBe(1);
  });
});
