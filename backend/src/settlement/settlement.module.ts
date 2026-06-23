import { Module } from '@nestjs/common';
import { SettlementService } from './settlement.service';
import { SettlementSyncService } from './settlement-sync.service';
import { SorobanEventsService } from './soroban-events.service';
import { SyncCursorService } from './sync-cursor.service';

@Module({
  providers: [
    SettlementService,
    SettlementSyncService,
    SorobanEventsService,
    SyncCursorService,
  ],
  exports: [SettlementService],
})
export class SettlementModule {}
