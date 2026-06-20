import { Module } from '@nestjs/common';
import { SettlementService } from './settlement.service';
import { SettlementController } from './settlement.controller';

@Module({
  providers: [SettlementService],
  controllers: [SettlementController],
})
export class SettlementModule {}
