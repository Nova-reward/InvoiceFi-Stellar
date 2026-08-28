/**
 * Idempotent scheduler for invoice payment reminders.
 *
 * Idempotency guarantees
 * ──────────────────────
 * Two mechanisms prevent double-sending when the NestJS process restarts mid-
 * interval or when multiple instances run concurrently (e.g. in a horizontally
 * scaled deployment):
 *
 *  1. Per-invoice deduplication key (`jobId` option on `queue.add`).
 *     Bull rejects any `add` call whose `jobId` already exists in the queue
 *     (waiting, active, or delayed).  The key encodes both the invoiceId and
 *     the current reminder window (truncated to 6-hour slots) so that:
 *     – Restarting within the same window does NOT produce a second job.
 *     – The next window produces a new, unique key and therefore a fresh job.
 *
 *  2. In-flight check (`getJobs(['waiting','active','delayed'])`).
 *     Used as a fast-path guard before calling `queue.add` to give a clear
 *     log message ("already queued") rather than relying solely on the
 *     silent Bull deduplication.  This check also covers jobs that Bull has
 *     already started processing (active) but not yet completed.
 *
 * The combination means that even if two scheduler instances fire
 * simultaneously, the second `queue.add` call with the same `jobId` will be a
 * no-op (Bull returns the existing job object without creating a duplicate).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { InvoiceService } from '../invoice/invoice.service';

/** Width of the deduplication window, must match the cron interval. */
const REMINDER_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Returns a stable slot identifier for the current 6-hour window.
 * Two calls within the same window return identical strings; calls in
 * adjacent windows return different strings.
 */
function reminderWindowSlot(now: Date = new Date()): string {
  const slot = Math.floor(now.getTime() / REMINDER_WINDOW_MS);
  return String(slot);
}

/**
 * Builds a Bull `jobId` that is unique per (invoiceId, 6-hour window).
 * Bull silently deduplicates `add` calls with the same `jobId`.
 */
function reminderJobId(invoiceId: string, slot: string): string {
  return `reminder:${invoiceId}:${slot}`;
}

@Injectable()
export class InvoiceReminderScheduler {
  private readonly logger = new Logger(InvoiceReminderScheduler.name);

  constructor(
    @InjectQueue('invoice-reminder') private readonly invoiceReminderQueue: Queue,
    private readonly invoiceService: InvoiceService,
  ) {}

  /**
   * Runs every 6 hours.  For each invoice due within 72 hours it attempts to
   * enqueue a "send-reminder" job.  The `jobId` option makes every enqueue
   * call idempotent for the current 6-hour window.
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async scheduleInvoiceReminders(): Promise<void> {
    this.logger.log('Starting scheduled invoice reminder check...');
    const slot = reminderWindowSlot();

    let invoices: Awaited<ReturnType<InvoiceService['findInvoicesDueSoon']>>;
    try {
      invoices = await this.invoiceService.findInvoicesDueSoon(72);
    } catch (error) {
      this.logger.error('Error fetching invoices due soon', (error as Error).stack);
      return;
    }

    this.logger.log(`Found ${invoices.length} invoices due within 72 hours`);

    // Fetch in-flight jobs once and share across the loop to avoid N queue
    // queries per invoice (a single fetch is enough for the informational log;
    // the jobId deduplication is the authoritative guard).
    let inFlightIds: Set<string>;
    try {
      const inFlightJobs = await this.invoiceReminderQueue.getJobs([
        'waiting',
        'active',
        'delayed',
      ]);
      inFlightIds = new Set(inFlightJobs.map((j) => String(j.opts?.jobId ?? j.id)));
    } catch (error) {
      this.logger.warn(
        'Could not fetch in-flight jobs; relying solely on jobId deduplication.',
        (error as Error).stack,
      );
      inFlightIds = new Set();
    }

    let scheduled = 0;
    let skipped = 0;

    for (const invoice of invoices) {
      const { id, userId, user, amount, dueDate, tokenType } = invoice;
      const jobId = reminderJobId(id, slot);

      // Fast-path informational guard (authoritative deduplication is jobId).
      if (inFlightIds.has(jobId)) {
        this.logger.debug(`Reminder already queued for invoice ${id} in window ${slot}, skipping`);
        skipped++;
        continue;
      }

      try {
        await this.invoiceReminderQueue.add(
          'send-reminder',
          {
            invoiceId: id,
            userId,
            userEmail: user.email,
            userName: user.name ?? 'Farmer',
            amount: amount.toString(),
            dueDate,
            tokenType,
          },
          {
            // Idempotency key: Bull silently deduplicates add() calls with the
            // same jobId when the job is still waiting/active/delayed.
            jobId,
            removeOnComplete: 10,
            removeOnFail: 50,
          },
        );

        this.logger.log(`Scheduled reminder for invoice ${id} (jobId: ${jobId})`);
        scheduled++;
      } catch (error) {
        // Log per-invoice errors but continue processing remaining invoices.
        this.logger.error(
          `Failed to enqueue reminder for invoice ${id}`,
          (error as Error).stack,
        );
      }
    }

    this.logger.log(
      `Completed invoice reminder check: ${scheduled} scheduled, ${skipped} already queued`,
    );
  }
}
