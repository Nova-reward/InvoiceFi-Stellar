import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { SorobanModule } from './soroban/soroban.module';
import { AuthModule } from './auth/auth.module';
import { InvoiceModule } from './invoice/invoice.module';
import { FinancingPoolModule } from './financing-pool/financing-pool.module';
import { SettlementModule } from './settlement/settlement.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    PrismaModule,
    SorobanModule,
    AuthModule,
    InvoiceModule,
    FinancingPoolModule,
    SettlementModule,
    HealthModule,
  ],
})
export class AppModule {}
