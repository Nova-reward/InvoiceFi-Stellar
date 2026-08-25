import { JwtPayload } from './jwt';

/** Authenticated caller derived from a verified JWT. */
export interface Principal {
  userId: string;
  walletAddress: string;
  /** Normalized to lowercase (e.g. "admin", "investor", "farmer"). */
  role: string;
}

export const ROLE_ADMIN = 'admin';

export function isAdmin(principal: Principal): boolean {
  return principal.role === ROLE_ADMIN;
}

/**
 * Build a Principal from a verified JWT payload, or throw if the payload is
 * missing the identity fields the compliance API requires.
 */
export function principalFromPayload(payload: JwtPayload): Principal {
  const role = typeof payload.role === 'string' ? payload.role.toLowerCase() : '';
  const walletAddress =
    typeof payload.walletAddress === 'string' ? payload.walletAddress : '';
  const userId =
    payload.sub === undefined || payload.sub === null
      ? ''
      : String(payload.sub);

  if (!role || !walletAddress || !userId) {
    throw new Error('Token missing required identity claims');
  }
  return { userId, walletAddress, role };
}
