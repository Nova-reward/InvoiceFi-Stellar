/**
 * DLQ processor for invoice-reminder jobs.
 *
 * Bull moves a job to the dead-letter queue when it has exhausted all attempts
 * configured on the source queue. This processor subscribes to that DLQ
 * ("invoice-reminder-dlq") and:
 *
 *  1. Writes an `InvoiceReminderFailure` row to the database for operational
 *     visibility and post-mortem querying.
 *  2. Dispatches an alert through `AlertDispatcherService` so on-call teams
 *     are notified immediately.
 *
 * The DLQ queue is declared with `attempts: 1` (no retries) so a failure in
 * the DLQ handler itself does NOT re-enter the DLQ — it surfaces as a normal
 * Bull failed job and is logged with a hard-error severity.
 */
import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { AlertDispatcherService } from '../monitoring/alert-dispatcher.service';
import { AnomalyAlert, AnomalyType } from '../monitoring/types';

interface InvoiceReminderJobData {
  invoiceId: string;
  userId: string;
  userEmail: string;
  userName: string;
  amount: string;
  dueDate: Date;
  tokenType: string;
}

/**
 * Cast helper: maps the DLQ failure to the closest meaningful AnomalyType.
 * "invoice_reminder_failure" is not a first-class AnomalyType today; we cast
 * to satisfy the TypeScript union while keeping the full context in `context`.
 * If/when a dedicated anomaly type is added to monitoring/types.ts, remove
 * this cast.
 */
const REMINDER_FAILURE_ANOMALY_TYPE = 'invoice_reminder_failure' as AnomalyType;

@Processor('invoice-reminder-dlq')
export class InvoiceReminderDlqProcessor {
  private readonly logger = new Logger(InvoiceReminderDlqProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alertDispatcher: AlertDispatcherService,
  ) {}

  /**
   * Main DLQ handler.  Called once per job that lands in the dead-letter queue
   * after all retry attempts on the source "invoice-reminder" queue have been
   * exhausted.
   */
  @Process('send-reminder')
  async handleDlq(job: Job<InvoiceReminderJobData>): Promise<void> {
    const { invoiceId, userEmail } = job.data;
    const attemptCount = job.attemptsMade;
    const errorMessage =
      (job.failedReason as string | undefined) ?? 'Unknown error after max retries';
    const jobId = String(job.id);

    this.logger.warn(
      `[DLQ] Exhausted retries for invoice ${invoiceId} (job ${jobId}, ${attemptCount} attempts): ${errorMessage}`,
    );

    // 1. Persist failure record ────────────────────────────────────────────
    try {
      await this.prisma.invoiceReminderFailure.create({
        data: {
          invoiceId,
          errorMessage,
          attemptCount,
          jobId,
        },
      });
    } catch (dbError) {
      // Non-fatal: log but don't let a DB write failure block the alert.
      this.logger.error(
        `[DLQ] Failed to persist InvoiceReminderFailure for invoice ${invoiceId}`,
        (dbError as Error).stack,
      );
    }

    // 2. Dispatch alert ────────────────────────────────────────────────────
    try {
      const alert: AnomalyAlert = {
        id: `invoice-reminder-dlq-${jobId}`,
        anomalyType: REMINDER_FAILURE_ANOMALY_TYPE,
        affectedAccountOrContract: userEmail ?? invoiceId,
        // No on-chain tx for a reminder failure; use a stable placeholder.
        transactionHash: `job:${jobId}`,
        currentMetric: attemptCount,
        threshold: attemptCount,
        // Reminder failures are off-chain; ledger 0 signals "not applicable".
        ledger: 0,
        occurredAt: new Date().toISOString(),
        severity: 'warning',
        summary: `Invoice reminder for ${invoiceId} failed after ${attemptCount} attempt(s): ${errorMessage}`,
        context: {
          invoiceId,
          jobId,
          attemptCount,
          errorMessage,
          userEmail,
        },
      };

      await this.alertDispatcher.dispatch(alert);
    } catch (alertError) {
      // Non-fatal: the DB record was (attempted to be) written; log the alert
      // failure and move on so Bull marks the DLQ job as complete.
      this.logger.error(
        `[DLQ] Failed to dispatch alert for invoice ${invoiceId}`,
        (alertError as Error).stack,
      );
    }
  }

  /**
   * DLQ handler itself failed (e.g. Prisma unavailable AND alert failed).
   * This is a hard failure — log at error level for ops visibility.
   */
  @OnQueueFailed()
  onDlqFailed(job: Job, error: Error): void {
    this.logger.error(
      `[DLQ] DLQ handler itself failed for job ${job.id} (invoice ${job.data?.invoiceId}): ${error.message}`,
      error.stack,
    );
  }
}
