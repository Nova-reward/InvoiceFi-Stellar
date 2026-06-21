import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { InvoiceService } from '../invoice/invoice.service';

@Injectable()
export class InvoiceReminderScheduler {
  private readonly logger = new Logger(InvoiceReminderScheduler.name);

  constructor(
    @InjectQueue('invoice-reminder') private invoiceReminderQueue: Queue,
    private invoiceService: InvoiceService,
  ) {}

  @Cron(CronExpression.EVERY_6_HOURS)
  async scheduleInvoiceReminders() {
    this.logger.log('Starting scheduled invoice reminder check...');

    try {
      // Find invoices due within 72 hours with FUNDED status
      const invoices = await this.invoiceService.findInvoicesDueSoon(72);

      this.logger.log(`Found ${invoices.length} invoices due within 72 hours`);

      for (const invoice of invoices) {
        const { id, userId, user, amount, dueDate, tokenType } = invoice;

        // Check if a reminder job already exists for this invoice
        const existingJobs = await this.invoiceReminderQueue.getJobs(['waiting', 'active', 'delayed']);
        const hasExistingJob = existingJobs.some(
          (job) => job.data.invoiceId === id && job.name === 'send-reminder',
        );

        if (hasExistingJob) {
          this.logger.log(`Reminder job already exists for invoice ${id}, skipping`);
          continue;
        }

        // Add job to queue
        await this.invoiceReminderQueue.add(
          'send-reminder',
          {
            invoiceId: id,
            userId,
            userEmail: user.email,
            userName: user.name || 'Farmer',
            amount: amount.toString(),
            dueDate,
            tokenType,
          },
          {
            removeOnComplete: 10,
            removeOnFail: 50,
          },
        );

        this.logger.log(`Scheduled reminder for invoice ${id}`);
      }

      this.logger.log('Completed scheduled invoice reminder check');
    } catch (error) {
      this.logger.error('Error during scheduled invoice reminder check', error.stack);
    }
  }
}
