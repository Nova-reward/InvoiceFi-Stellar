import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { nextRetryDelayMs } from './retry-schedule';
import {
  signWebhookPayload,
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from './webhook-signing';

/** How many due deliveries a single poll tick claims and attempts at once. */
export const BATCH_SIZE = 20;
/** How often the worker checks for due deliveries. */
export const POLL_INTERVAL_MS = 15_000;
/** Per-attempt HTTP timeout, so one hung subscriber can't stall a whole batch. */
export const REQUEST_TIMEOUT_MS = 10_000;
/** A PROCESSING row untouched this long is assumed to belong to a crashed worker and is reclaimed. */
export const STUCK_PROCESSING_MS = 5 * 60_000;

interface ClaimedDelivery {
  id: string;
  subscriptionId: string;
  eventType: string;
  payload: unknown;
  attemptCount: number;
}

/**
 * Polls the persistent `WebhookDelivery` queue and attempts due deliveries.
 *
 * Claiming uses `SELECT ... FOR UPDATE SKIP LOCKED` so that when the backend
 * runs as multiple instances, no two of them ever pick up and deliver the
 * same row concurrently (duplicate-delivery suppression at the queue level,
 * complementing the idempotency-key suppression at enqueue time in
 * `WebhookDispatchService`).
 */
@Injectable()
export class WebhookDeliveryWorkerService {
  private readonly logger = new Logger(WebhookDeliveryWorkerService.name);
  private polling = false;

  constructor(private readonly prisma: PrismaService) {}

  @Interval(POLL_INTERVAL_MS)
  async poll(): Promise<void> {
    // A batch that takes longer than the poll interval (e.g. many slow
    // subscribers) should finish before the next tick starts a new one.
    if (this.polling) return;
    this.polling = true;
    try {
      await this.processDueDeliveries();
    } catch (err) {
      this.logger.error(
        `Webhook delivery poll failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.polling = false;
    }
  }

  /** Claim and attempt one batch of due deliveries. Returns how many were attempted. */
  async processDueDeliveries(): Promise<number> {
    const claimed = await this.claimBatch(BATCH_SIZE);
    if (claimed.length === 0) return 0;
    await Promise.all(claimed.map((delivery) => this.attemptDelivery(delivery)));
    return claimed.length;
  }

  private async claimBatch(limit: number): Promise<ClaimedDelivery[]> {
    return this.prisma.db.$queryRaw<ClaimedDelivery[]>`
      UPDATE "WebhookDelivery"
      SET status = 'PROCESSING', "lockedAt" = now()
      WHERE id IN (
        SELECT id FROM "WebhookDelivery"
        WHERE (status = 'PENDING' AND "nextAttemptAt" <= now())
           OR (status = 'PROCESSING' AND "lockedAt" < now() - make_interval(secs => ${STUCK_PROCESSING_MS / 1000}))
        ORDER BY "nextAttemptAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, "subscriptionId", "eventType", payload, "attemptCount";
    `;
  }

  private async attemptDelivery(delivery: ClaimedDelivery): Promise<void> {
    const attemptNumber = delivery.attemptCount + 1;
    const startedAt = Date.now();
    const subscription = await this.prisma.webhookSubscription.findUnique({
      where: { id: delivery.subscriptionId },
    });

    if (!subscription || !subscription.active) {
      await this.logAttempt(delivery.id, attemptNumber, false, undefined, 'subscription revoked or deleted', Date.now() - startedAt);
      await this.finalize(delivery.id, {
        status: 'ABANDONED',
        attemptCount: attemptNumber,
        lastAttemptAt: new Date(),
        lastStatusCode: null,
        lastError: 'subscription revoked or deleted',
      });
      return;
    }

    const rawBody = JSON.stringify(delivery.payload);
    const signature = signWebhookPayload(subscription.secret, rawBody);

    let statusCode: number | undefined;
    let errorMessage: string | undefined;
    let success = false;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(subscription.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [WEBHOOK_SIGNATURE_HEADER]: signature,
          [WEBHOOK_EVENT_HEADER]: delivery.eventType,
          [WEBHOOK_DELIVERY_ID_HEADER]: delivery.id,
          [WEBHOOK_TIMESTAMP_HEADER]: new Date().toISOString(),
        },
        body: rawBody,
        signal: controller.signal,
      });
      statusCode = response.status;
      success = response.ok;
      if (!success) errorMessage = `Subscriber responded ${response.status}`;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Unknown delivery error';
    } finally {
      clearTimeout(timeout);
    }

    const durationMs = Date.now() - startedAt;
    await this.logAttempt(delivery.id, attemptNumber, success, statusCode, errorMessage, durationMs);

    if (success) {
      await this.finalize(delivery.id, {
        status: 'DELIVERED',
        attemptCount: attemptNumber,
        lastAttemptAt: new Date(),
        lastStatusCode: statusCode ?? null,
        lastError: null,
      });
      return;
    }

    const delayMs = nextRetryDelayMs(attemptNumber);
    if (delayMs === null) {
      await this.finalize(delivery.id, {
        status: 'ABANDONED',
        attemptCount: attemptNumber,
        lastAttemptAt: new Date(),
        lastStatusCode: statusCode ?? null,
        lastError: errorMessage ?? null,
      });
      this.logger.error(
        `Webhook delivery ${delivery.id} abandoned after ${attemptNumber} attempts ` +
          `(subscription ${subscription.id}, url ${subscription.url}): ${errorMessage}`,
      );
      return;
    }

    await this.finalize(delivery.id, {
      status: 'PENDING',
      attemptCount: attemptNumber,
      nextAttemptAt: new Date(Date.now() + delayMs),
      lastAttemptAt: new Date(),
      lastStatusCode: statusCode ?? null,
      lastError: errorMessage ?? null,
    });
  }

  private async finalize(
    id: string,
    data: {
      status: 'PENDING' | 'DELIVERED' | 'ABANDONED';
      attemptCount: number;
      nextAttemptAt?: Date;
      lastAttemptAt: Date;
      lastStatusCode: number | null;
      lastError: string | null;
    },
  ): Promise<void> {
    await this.prisma.webhookDelivery.update({ where: { id }, data });
  }

  private async logAttempt(
    deliveryId: string,
    attemptNumber: number,
    success: boolean,
    statusCode: number | undefined,
    error: string | undefined,
    durationMs: number,
  ): Promise<void> {
    await this.prisma.webhookDeliveryAttempt.create({
      data: {
        deliveryId,
        attemptNumber,
        success,
        statusCode: statusCode ?? null,
        error: error ?? null,
        durationMs,
      },
    });
  }
}
