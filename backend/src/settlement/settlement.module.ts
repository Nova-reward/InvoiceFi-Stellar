import { Module } from '@nestjs/common';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { PrismaModule } from '../prisma/prisma.module';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { RedisService } from '../common/redis.service';
import { SettlementService } from './settlement.service';
import { SettlementSyncService } from './settlement-sync.service';
import { SettlementSyncAdminController } from './settlement-sync-admin.controller';
import { SorobanEventsService } from './soroban-events.service';
import { SyncCursorService } from './sync-cursor.service';
import { SettlementController } from './settlement.controller';

@Module({
  imports: [WebhooksModule, PrismaModule],
  controllers: [SettlementController, SettlementSyncAdminController],
  providers: [
    SettlementService,
    SettlementSyncService,
    SorobanEventsService,
    SyncCursorService,
    IdempotencyInterceptor,
    RedisService,
  ],
  exports: [SettlementService],
})
export class SettlementModule {}
