import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { VaultModule } from './config/vault/vault.module';
import { HealthModule } from './health/health.module';
import { InvoicesModule } from './invoices/invoices.module';
import { PrismaModule } from './prisma/prisma.module';
import { SettlementModule } from './settlement/settlement.module';

@Module({
  imports: [
    // ConfigModule provides access to non-secret env vars (PORT, VAULT_ADDR, etc.)
    ConfigModule.forRoot({ isGlobal: true }),
    // VaultModule MUST come before any module that injects secrets.
    // It is @Global, so secrets are available application-wide.
    VaultModule,
    ScheduleModule.forRoot(),
    PrismaModule,
    SettlementModule,
    InvoicesModule,
    HealthModule,
  ],
})
export class AppModule {}
