import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ComplianceModule } from './compliance/compliance.module';
import { HealthModule } from './health/health.module';
import { InvoicesModule } from './invoices/invoices.module';
import { PrismaModule } from './prisma/prisma.module';
import { SettlementModule } from './settlement/settlement.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { OracleMonitorModule } from './oracle-monitor/oracle-monitor.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { VaultModule } from './config/vault/vault.module';
import { RedisService } from './common/redis.service';
import { RateLimiterService } from './common/rate-limiter.service';
import { CircuitBreakerService } from './common/circuit-breaker.service';
import { RateLimitMiddleware } from './common/rate-limit.middleware';

@Module({
  imports: [
    // ConfigModule provides access to non-secret env vars (PORT, VAULT_ADDR, etc.)
    ConfigModule.forRoot({ isGlobal: true }),
    // VaultModule MUST come before any module that injects secrets.
    // It is @Global, so secrets are available application-wide.
    VaultModule,
    ScheduleModule.forRoot(),
    PrismaModule,
    WebhooksModule,
    SettlementModule,
    InvoicesModule,
    ComplianceModule,
    HealthModule,
    OracleMonitorModule,
  ],
  // JwtService is used by the rate-limit middleware to verify bearer claims
  // before controller guards run; the signing secret is supplied from Vault
  // at verification time rather than stored in this module.
  providers: [RedisService, RateLimiterService, CircuitBreakerService, JwtService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RateLimitMiddleware).forRoutes('*');
  }
}
