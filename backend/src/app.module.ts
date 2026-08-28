import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ComplianceModule } from './compliance/compliance.module';
import { HealthModule } from './health/health.module';
import { InvoicesModule } from './invoices/invoices.module';
import { InvoiceModule } from './invoice/invoice.module';
import { PrismaModule } from './prisma/prisma.module';
import { SettlementModule } from './settlement/settlement.module';
import { FinancingPoolModule } from './financing-pool/financing-pool.module';
import { OracleMonitorModule } from './oracle-monitor/oracle-monitor.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { VaultModule } from './config/vault/vault.module';
import { IdempotencyModule } from './common/idempotency.module';
import { RedisService } from './common/redis.service';
import { RateLimiterService } from './common/rate-limiter.service';
import { CircuitBreakerService } from './common/circuit-breaker.service';
import { RateLimitMiddleware } from './common/rate-limit.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    VaultModule,
    ScheduleModule.forRoot(),
    PrismaModule,
    WebhooksModule,
    SettlementModule,
    InvoicesModule,
    InvoiceModule,
    FinancingPoolModule,
    ComplianceModule,
    HealthModule,
    OracleMonitorModule,
    IdempotencyModule,
  ],
  providers: [RedisService, RateLimiterService, CircuitBreakerService, JwtService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RateLimitMiddleware).forRoutes('*');
  }
}
