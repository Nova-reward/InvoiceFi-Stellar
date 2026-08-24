import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolvePrincipal } from '../compliance/compliance-access.guard';
import { ExportRequest } from '../compliance/http';

/**
 * Authenticates webhook management requests (registering/listing/revoking
 * subscriptions, reading delivery logs) and attaches the verified
 * `Principal` to `req.principal`. Uses the same HS256 tokens and extraction
 * rules as `ComplianceAccessGuard` — see `resolvePrincipal`. Ownership (a
 * caller may only manage their own subscriptions unless admin) is enforced
 * downstream in `WebhookSubscriptionsService`.
 */
@Injectable()
export class WebhookAccessGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<ExportRequest>();
    const secret = this.config.get<string>('JWT_SECRET') ?? 'dev_secret';
    req.principal = resolvePrincipal(req, secret);
    return true;
  }
}
