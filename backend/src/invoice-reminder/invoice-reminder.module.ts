/**
 * InvoiceReminderModule
 *
 * Wires together the reminder scheduler, the main processor, and the DLQ
 * processor.  Two Bull queues are registered:
 *
 *  • "invoice-reminder"      — primary queue; jobs retry up to N times.
 *  • "invoice-reminder-dlq"  — dead-letter queue; exhausted jobs land here
 *                              for failure logging and alert dispatch.
 *
 * Queue option notes
 * ──────────────────
 * The primary queue's `defaultJobOptions.attempts` is intentionally left at 3
 * here (the module-level default).  At runtime the processor reads
 * `INVOICE_REMINDER_MAX_ATTEMPTS` from env and uses that value when deciding
 * whether to forward a job to the DLQ; the two values should be kept in sync
 * by setting `INVOICE_REMINDER_MAX_ATTEMPTS` to the same number.  An upcoming
 * refactor will drive `attempts` from the env value directly.
 *
 * The DLQ queue is configured with `attempts: 1` so DLQ jobs are never
 * automatically retried.
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { InvoiceReminderProcessor } from './invoice-reminder.processor';
import { InvoiceReminderDlqProcessor } from './invoice-reminder-dlq.processor';
import { InvoiceReminderScheduler } from './invoice-reminder.scheduler';
import { InvoiceModule } from '../invoice/invoice.module';
import { NotificationModule } from '../notification/notification.module';
import { EmailModule } from '../email/email.module';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    // Make ConfigService available to InvoiceReminderProcessor.
    ConfigModule,

    // Domain modules required by the processor.
    InvoiceModule,
    NotificationModule,
    EmailModule,

    // Monitoring (AlertDispatcherService) and persistence (PrismaService)
    // required by the DLQ processor.
    MonitoringModule,
    PrismaModule,

    // Primary reminder queue.
    BullModule.registerQueue({
      name: 'invoice-reminder',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5_000,
        },
        removeOnComplete: 10,
        removeOnFail: 50,
      },
    }),

    // Dead-letter queue — no automatic retries so DLQ handler runs exactly once.
    BullModule.registerQueue({
      name: 'invoice-reminder-dlq',
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: 50,
      },
    }),
  ],
  providers: [
    InvoiceReminderProcessor,
    InvoiceReminderDlqProcessor,
    InvoiceReminderScheduler,
  ],
})
export class InvoiceReminderModule {}
