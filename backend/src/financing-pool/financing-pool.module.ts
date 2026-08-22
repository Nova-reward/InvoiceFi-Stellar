import { Module } from '@nestjs/common';
import { FinancingPoolController } from './financing-pool.controller';
import { FinancingPoolService } from './financing-pool.service';
import { RedisService } from '../common/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanService } from '../soroban/soroban.service';
import { OracleMonitorModule } from '../oracle-monitor/oracle-monitor.module';

@Module({
  imports: [OracleMonitorModule],
  controllers: [FinancingPoolController],
  providers: [
    FinancingPoolService,
    RedisService,
    PrismaService,
    SorobanService,
  ],
  exports: [FinancingPoolService],
})
export class FinancingPoolModule {}