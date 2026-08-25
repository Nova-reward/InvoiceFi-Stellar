import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExportRequest } from './http';
import { verifyHs256Jwt } from './jwt';
import { Principal, principalFromPayload } from './principal';

/**
 * Verify the caller's HS256 token (from the `Authorization: Bearer` header or
 * the `token` cookie set at wallet connect) and return the resulting
 * `Principal`. Shared by every guard in the backend that authenticates
 * against the tokens issued at wallet connect — see also
 * `WebhookAccessGuard` — so they stay byte-for-byte consistent about where a
 * token may come from and how it is verified.
 */
export function resolvePrincipal(
  req: ExportRequest,
  secret: string,
): Principal {
  const token = extractToken(req);
  if (!token) {
    throw new UnauthorizedException('Missing authentication token');
  }

  try {
    const payload = verifyHs256Jwt(token, secret);
    return principalFromPayload(payload);
  } catch (err) {
    throw new UnauthorizedException(
      err instanceof Error ? err.message : 'Invalid token',
    );
  }
}

/**
 * Authenticates compliance requests and attaches the verified `Principal` to
 * `req.principal`. It accepts the same HS256 tokens the rest of the backend
 * issues, taken from either the `Authorization: Bearer` header or the `token`
 * cookie set at wallet connect. Authorization (admin-vs-self scoping) is
 * enforced downstream in ComplianceService once the subject is known.
 */
@Injectable()
export class ComplianceAccessGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<ExportRequest>();
    const secret = this.config.get<string>('JWT_SECRET') ?? 'dev_secret';
    req.principal = resolvePrincipal(req, secret);
    return true;
  }
}

function extractToken(req: ExportRequest): string | null {
  const auth = req.headers?.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim();
  }
  // Fall back to the httpOnly `token` cookie set by /auth/connect-wallet.
  const cookieHeader = req.headers?.cookie;
  if (typeof cookieHeader === 'string') {
    for (const part of cookieHeader.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === 'token' && rest.length) {
        return decodeURIComponent(rest.join('='));
      }
    }
  }
  return null;
}
