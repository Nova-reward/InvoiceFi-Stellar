import { BadRequestException, Injectable } from '@nestjs/common';
import { WebhookDelivery, WebhookDeliveryAttempt, WebhookDeliveryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookDeliveryView } from './dto/webhook.dto';

const DELIVERY_STATUSES: readonly string[] = Object.values(WebhookDeliveryStatus);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface ListDeliveriesOptions {
  status?: string;
  limit?: number;
}

/**
 * Read-side query API for the delivery log (acceptance criterion: "Delivery
 * attempts ... are logged and queryable via API"). Kept separate from
 * `WebhookSubscriptionsService` (registration) and `WebhookDeliveryWorkerService`
 * (the write side / actual HTTP delivery) since this is purely a read path.
 */
@Injectable()
export class WebhookDeliveryLogService {
  constructor(private readonly prisma: PrismaService) {}

  async listForSubscription(
    subscriptionId: string,
    options: ListDeliveriesOptions = {},
  ): Promise<WebhookDeliveryView[]> {
    const where: { subscriptionId: string; status?: WebhookDeliveryStatus } = { subscriptionId };
    if (options.status !== undefined) {
      if (!DELIVERY_STATUSES.includes(options.status)) {
        throw new BadRequestException(
          `Invalid status: ${options.status}. Valid: ${DELIVERY_STATUSES.join(', ')}`,
        );
      }
      where.status = options.status as WebhookDeliveryStatus;
    }

    const limit = clampLimit(options.limit);
    const deliveries = await this.prisma.webhookDelivery.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { attempts: { orderBy: { attemptNumber: 'asc' } } },
    });
    return deliveries.map(toView);
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
}

type DeliveryWithAttempts = WebhookDelivery & { attempts: WebhookDeliveryAttempt[] };

function toView(delivery: DeliveryWithAttempts): WebhookDeliveryView {
  return {
    id: delivery.id,
    subscriptionId: delivery.subscriptionId,
    eventType: delivery.eventType,
    status: delivery.status,
    attemptCount: delivery.attemptCount,
    nextAttemptAt: delivery.nextAttemptAt.toISOString(),
    lastAttemptAt: delivery.lastAttemptAt?.toISOString() ?? null,
    lastStatusCode: delivery.lastStatusCode,
    lastError: delivery.lastError,
    createdAt: delivery.createdAt.toISOString(),
    updatedAt: delivery.updatedAt.toISOString(),
    attempts: delivery.attempts.map((attempt) => ({
      attemptNumber: attempt.attemptNumber,
      attemptedAt: attempt.attemptedAt.toISOString(),
      success: attempt.success,
      statusCode: attempt.statusCode,
      error: attempt.error,
      durationMs: attempt.durationMs,
    })),
  };
}
