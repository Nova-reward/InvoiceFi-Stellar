import { Module } from '@nestjs/common';
import { FinancingPoolController } from './financing-pool.controller';
import { FinancingPoolService } from './financing-pool.service';
import { RedisService } from '../common/redis.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SorobanService } from '../soroban/soroban.service';
import { OracleMonitorModule } from '../oracle-monitor/oracle-monitor.module';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';

@Module({
  imports: [OracleMonitorModule, PrismaModule],
  controllers: [FinancingPoolController],
  providers: [
    FinancingPoolService,
    RedisService,
    SorobanService,
    IdempotencyInterceptor,
  ],
  exports: [FinancingPoolService],
})
export class FinancingPoolModule {}
