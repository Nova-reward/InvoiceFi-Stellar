import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
  providers: [RedisService, RateLimiterService, CircuitBreakerService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RateLimitMiddleware).forRoutes('*');
  }
}
