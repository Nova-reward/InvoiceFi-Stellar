import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { VaultService } from '../config/vault/vault.service';

interface JwtPayload {
  sub: string;
  walletAddress: string;
  role: string;
  iat?: number;
  exp?: number;
}

interface AuthenticatedUser {
  userId: string;
  walletAddress: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(vault: VaultService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // JWT secret sourced from Vault, not process.env.
      secretOrKey: vault.auth.jwt_secret,
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    if (
      !payload?.role ||
      !['farmer', 'investor', 'admin'].includes(payload.role.toLowerCase())
    ) {
      throw new UnauthorizedException('Invalid or missing role in token');
    }

    if (!payload.sub || !payload.walletAddress) {
      throw new UnauthorizedException(
        'Invalid token: missing user information',
      );
    }

    return {
      userId: payload.sub,
      walletAddress: payload.walletAddress,
      role: payload.role,
    };
  }
}
