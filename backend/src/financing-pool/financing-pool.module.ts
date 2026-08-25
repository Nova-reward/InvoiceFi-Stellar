import { Module } from '@nestjs/common';
import { FinancingPoolService } from './financing-pool.service';
import { FinancingPoolController } from './financing-pool.controller';
import { OracleMonitorModule } from '../oracle-monitor/oracle-monitor.module';

@Module({
  imports: [OracleMonitorModule],
  providers: [FinancingPoolService],
  controllers: [FinancingPoolController],
})
export class FinancingPoolModule {}
