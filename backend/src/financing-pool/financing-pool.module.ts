import { Module } from '@nestjs/common';
import { FinancingPoolService } from './financing-pool.service';
import { FinancingPoolController } from './financing-pool.controller';

@Module({
  providers: [FinancingPoolService],
  controllers: [FinancingPoolController],
})
export class FinancingPoolModule {}
