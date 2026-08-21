/**
 * Bull processor for the "invoice-reminder" queue.
 *
 * Retry behaviour
 * ───────────────
 * The queue is configured with `attempts` equal to `INVOICE_REMINDER_MAX_ATTEMPTS`
 * (env, default 3) and an exponential backoff starting at 5 s.  Bull retries
 * automatically on thrown errors.
 *
 * Dead-letter forwarding
 * ──────────────────────
 * `@OnQueueFailed` fires after every failed attempt.  When `job.attemptsMade`
 * reaches the configured maximum the handler considers the job exhausted and
 * forwards it to the "invoice-reminder-dlq" queue so the DLQ processor
 * (`InvoiceReminderDlqProcessor`) can write the failure log and dispatch an
 * alert.  Bull itself does not provide a native DLQ; this pattern replicates
 * the semantics by adding the job data to a second queue once all retries are
 * gone.
 */
import {
  Processor,
  Process,
  OnQueueActive,
  OnQueueCompleted,
  OnQueueFailed,
  InjectQueue,
} from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bull';
import { InvoiceService } from '../invoice/invoice.service';
import { NotificationService } from '../notification/notification.service';
import { EmailService } from '../email/email.service';

interface InvoiceReminderJobData {
  invoiceId: string;
  userId: string;
  userEmail: string;
  userName: string;
  amount: string;
  dueDate: Date;
  tokenType: string;
}

/** Resolves the configured maximum attempt count, falling back to 3. */
function resolveMaxAttempts(config: ConfigService): number {
  const raw = config.get<string>('INVOICE_REMINDER_MAX_ATTEMPTS');
  const parsed = parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

@Processor('invoice-reminder')
export class InvoiceReminderProcessor {
  private readonly logger = new Logger(InvoiceReminderProcessor.name);
  private readonly maxAttempts: number;

  constructor(
    private readonly invoiceService: InvoiceService,
    private readonly notificationService: NotificationService,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
    @InjectQueue('invoice-reminder-dlq')
    private readonly dlqQueue: Queue,
  ) {
    this.maxAttempts = resolveMaxAttempts(config);
    this.logger.log(`Invoice reminder max attempts: ${this.maxAttempts}`);
  }

  // ─── Job handler ──────────────────────────────────────────────────────────

  @Process('send-reminder')
  async handleReminder(job: Job<InvoiceReminderJobData>): Promise<{ success: true; invoiceId: string }> {
    const { invoiceId, userId, userEmail, userName, amount, dueDate, tokenType } = job.data;

    this.logger.log(
      `Processing invoice reminder for invoice ${invoiceId} (attempt ${job.attemptsMade + 1}/${this.maxAttempts})`,
    );

    // Send email notification
    await this.emailService.sendInvoiceReminder({
      to: userEmail,
      userName,
      invoiceId,
      amount,
      dueDate,
      tokenType,
    });

    // Create in-app notification
    await this.notificationService.create({
      userId,
      type: 'INVOICE_DUE',
      title: 'Invoice Payment Reminder',
      message: `Your invoice ${invoiceId} for ${amount} ${tokenType} is due on ${new Date(dueDate).toLocaleDateString()}.`,
      metadata: {
        invoiceId,
        amount,
        dueDate,
        tokenType,
      },
    });

    this.logger.log(`Successfully sent reminder for invoice ${invoiceId}`);
    return { success: true, invoiceId };
  }

  // ─── Queue event hooks ────────────────────────────────────────────────────

  @OnQueueActive()
  onActive(job: Job): void {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);
  }

  @OnQueueCompleted()
  onCompleted(job: Job, result: unknown): void {
    this.logger.log(
      `Completed job ${job.id} of type ${job.name}. Result: ${JSON.stringify(result)}`,
    );
  }

  /**
   * Fires after every failed attempt.
   *
   * On the final attempt (`job.attemptsMade === this.maxAttempts`) Bull will
   * not schedule a retry, so we forward the job data to the DLQ queue.
   * Intermediate failures are logged at warn level; Bull handles the backoff
   * and re-scheduling automatically.
   */
  @OnQueueFailed()
  async onFailed(job: Job<InvoiceReminderJobData>, error: Error): Promise<void> {
    const { invoiceId } = job.data;

    if (job.attemptsMade >= this.maxAttempts) {
      this.logger.error(
        `[DLQ] Exhausted ${this.maxAttempts} attempts for invoice ${invoiceId} (job ${job.id}). Forwarding to DLQ.`,
        error.stack,
      );

      try {
        await this.dlqQueue.add(
          'send-reminder',
          {
            ...job.data,
            // Carry over the failure reason so the DLQ processor can log it
            // without having to query Bull's completed/failed sets.
            _failedReason: error.message,
          },
          {
            // No retries on the DLQ — the DLQ handler itself is the final
            // handler and should not loop back.
            attempts: 1,
            removeOnComplete: true,
            removeOnFail: 50,
          },
        );
      } catch (dlqError) {
        // Log but do not rethrow: we are inside a Bull event hook so throwing
        // here would have no effect on the original job state.
        this.logger.error(
          `[DLQ] Failed to enqueue job for invoice ${invoiceId} on DLQ`,
          (dlqError as Error).stack,
        );
      }
    } else {
      this.logger.warn(
        `Failed job ${job.id} for invoice ${invoiceId} (attempt ${job.attemptsMade}/${this.maxAttempts}). Will retry. Error: ${error.message}`,
      );
    }
  }
}
