import { Module } from '@nestjs/common';
import { OracleModule } from '../oracle/oracle.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { SettlementService } from './settlement.service';
import { SettlementSyncService } from './settlement-sync.service';
import { SorobanEventsService } from './soroban-events.service';
import { SyncCursorService } from './sync-cursor.service';

@Module({
  imports: [WebhooksModule, OracleModule],
  providers: [
    SettlementService,
    SettlementSyncService,
    SorobanEventsService,
    SyncCursorService,
  ],
  exports: [SettlementService],
})
export class SettlementModule {}
