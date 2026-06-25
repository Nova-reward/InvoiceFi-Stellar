import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'secretKey',
    });
  }

  async validate(payload: any) {
    if (!payload || !payload.role || !['farmer', 'investor', 'admin'].includes(payload.role.toLowerCase())) {
      throw new UnauthorizedException('Invalid or missing role in token');
    }
    
    if (!payload.sub || !payload.walletAddress) {
      throw new UnauthorizedException('Invalid token: missing user information');
    }

    return { 
      userId: payload.sub, 
      walletAddress: payload.walletAddress,
      role: payload.role 
    };
  }
}
