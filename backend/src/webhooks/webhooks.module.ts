import { Module } from '@nestjs/common';
import { WebhookAccessGuard } from './webhook-access.guard';
import { WebhookDeliveryLogService } from './webhook-delivery-log.service';
import { WebhookDeliveryWorkerService } from './webhook-delivery-worker.service';
import { WebhookDispatchService } from './webhook-dispatch.service';
import { WebhookSubscriptionsService } from './webhook-subscriptions.service';
import { WebhooksController } from './webhooks.controller';

/**
 * Webhook delivery system for invoice lifecycle events (issue #60):
 * registration API, a persistent (Postgres-backed) delivery queue processed
 * on a schedule with HMAC-SHA256 signing and exponential-ish backoff retry,
 * and a delivery log API for debugging. `WebhookDispatchService` is exported
 * so other modules (settlement, invoice creation/funding once implemented)
 * can enqueue lifecycle events without depending on the rest of this module.
 */
@Module({
  controllers: [WebhooksController],
  providers: [
    WebhookAccessGuard,
    WebhookSubscriptionsService,
    WebhookDeliveryLogService,
    WebhookDispatchService,
    WebhookDeliveryWorkerService,
  ],
  exports: [WebhookDispatchService],
})
export class WebhooksModule {}
