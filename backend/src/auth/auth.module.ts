import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { VaultService } from '../config/vault/vault.service';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule,
    /**
     * JwtModule is configured asynchronously so that the JWT secret is read
     * from VaultService (already loaded during bootstrap) rather than from
     * process.env. VaultService is provided globally by VaultModule.
     */
    JwtModule.registerAsync({
      inject: [VaultService],
      useFactory: (vault: VaultService) => ({
        secret: vault.auth.jwt_secret,
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [JwtModule],
})
export class AuthModule {}
