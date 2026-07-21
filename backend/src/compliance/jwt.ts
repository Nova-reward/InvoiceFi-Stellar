import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Minimal HS256 JWT verification.
 *
 * The rest of the backend issues HS256 tokens signed with `JWT_SECRET`
 * (see AuthModule / JwtStrategy). Rather than pull in a JWT library that is
 * not currently an installed dependency, the compliance access guard verifies
 * those same tokens using Node's `crypto`. Only HS256 is accepted; the "alg"
 * header is validated to avoid algorithm-confusion attacks.
 */

export interface JwtPayload {
  sub?: string | number;
  walletAddress?: string;
  role?: string;
  exp?: number;
  [key: string]: unknown;
}

export class JwtVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JwtVerificationError';
  }
}

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

function base64UrlEncode(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Verify an HS256 JWT and return its decoded payload. Throws
 * `JwtVerificationError` for any malformed token, wrong algorithm, bad
 * signature, or expired token. `nowSeconds` is injectable for testing.
 */
export function verifyHs256Jwt(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new JwtVerificationError('Malformed token');
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(base64UrlDecode(encodedHeader).toString('utf8'));
  } catch {
    throw new JwtVerificationError('Invalid token header');
  }
  if (header.alg !== 'HS256') {
    throw new JwtVerificationError(`Unsupported algorithm: ${header.alg}`);
  }

  const expected = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  const provided = base64UrlDecode(encodedSignature);
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    throw new JwtVerificationError('Invalid signature');
  }

  let payload: JwtPayload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload).toString('utf8'));
  } catch {
    throw new JwtVerificationError('Invalid token payload');
  }

  if (typeof payload.exp === 'number' && nowSeconds >= payload.exp) {
    throw new JwtVerificationError('Token expired');
  }

  return payload;
}

/** Re-encode helper exposed for tests that need to mint tokens. */
export function signHs256Jwt(payload: JwtPayload, secret: string): string {
  const header = base64UrlEncode(
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf8'),
  );
  const body = base64UrlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const signature = base64UrlEncode(
    createHmac('sha256', secret).update(`${header}.${body}`).digest(),
  );
  return `${header}.${body}.${signature}`;
}
