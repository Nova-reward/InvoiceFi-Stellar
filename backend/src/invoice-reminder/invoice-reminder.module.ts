import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { InvoiceReminderProcessor } from './invoice-reminder.processor';
import { InvoiceReminderScheduler } from './invoice-reminder.scheduler';
import { InvoiceModule } from '../invoice/invoice.module';
import { NotificationModule } from '../notification/notification.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    InvoiceModule,
    NotificationModule,
    EmailModule,
    BullModule.registerQueue({
      name: 'invoice-reminder',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 10,
        removeOnFail: 50,
      },
    }),
  ],
  providers: [InvoiceReminderProcessor, InvoiceReminderScheduler],
})
export class InvoiceReminderModule {}
