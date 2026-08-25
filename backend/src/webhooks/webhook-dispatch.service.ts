import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ALL_EVENTS_WILDCARD, InvoiceEvent } from './webhook-event.types';

/** Prisma's unique-constraint-violation error code. */
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Fans an invoice lifecycle event out to every active, interested
 * subscription by enqueueing one `WebhookDelivery` row each. This is the
 * only piece of the webhook system called inline from invoice-processing
 * code paths (e.g. `SettlementService`); it never makes an HTTP request
 * itself, so a slow or unreachable subscriber can never block invoice
 * processing — actual delivery happens later, off the request path, on
 * `WebhookDeliveryWorkerService`'s schedule.
 */
@Injectable()
export class WebhookDispatchService {
  private readonly logger = new Logger(WebhookDispatchService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Enqueue a delivery for every active subscription interested in `event`. Returns the number enqueued. */
  async dispatchInvoiceEvent(event: InvoiceEvent): Promise<number> {
    const subscriptions = await this.prisma.webhookSubscription.findMany({
      where: { active: true },
    });
    const interested = subscriptions.filter(
      (subscription) =>
        subscription.eventTypes.includes(ALL_EVENTS_WILDCARD) ||
        subscription.eventTypes.includes(event.event),
    );
    if (interested.length === 0) return 0;

    const idempotencyKey = buildIdempotencyKey(event);
    let enqueued = 0;
    for (const subscription of interested) {
      try {
        await this.prisma.webhookDelivery.create({
          data: {
            subscriptionId: subscription.id,
            eventType: event.event,
            idempotencyKey,
            payload: event as unknown as Prisma.InputJsonValue,
            nextAttemptAt: new Date(),
          },
        });
        enqueued++;
      } catch (err) {
        if (isUniqueConstraintViolation(err)) {
          // Duplicate suppression: the same lifecycle event was already
          // enqueued for this subscription (e.g. an at-least-once upstream
          // emitter retried). Skip rather than deliver twice.
          this.logger.debug(
            `Duplicate webhook enqueue suppressed for subscription ${subscription.id}, event ${idempotencyKey}`,
          );
          continue;
        }
        this.logger.error(
          `Failed to enqueue webhook delivery for subscription ${subscription.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return enqueued;
  }
}

function buildIdempotencyKey(event: InvoiceEvent): string {
  return createHash('sha256')
    .update(`${event.invoiceId}:${event.event}:${event.timestamp}`)
    .digest('hex');
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === UNIQUE_CONSTRAINT_VIOLATION
  );
}
