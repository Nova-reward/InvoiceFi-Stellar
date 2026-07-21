import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExportRequest } from './http';
import { verifyHs256Jwt } from './jwt';
import { principalFromPayload } from './principal';

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
    const token = extractToken(req);
    if (!token) {
      throw new UnauthorizedException('Missing authentication token');
    }

    const secret = this.config.get<string>('JWT_SECRET') ?? 'dev_secret';
    try {
      const payload = verifyHs256Jwt(token, secret);
      req.principal = principalFromPayload(payload);
      return true;
    } catch (err) {
      throw new UnauthorizedException(
        err instanceof Error ? err.message : 'Invalid token',
      );
    }
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
