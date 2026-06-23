import { Processor, Process, OnQueueActive, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
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

@Processor('invoice-reminder')
export class InvoiceReminderProcessor {
  private readonly logger = new Logger(InvoiceReminderProcessor.name);

  constructor(
    private invoiceService: InvoiceService,
    private notificationService: NotificationService,
    private emailService: EmailService,
  ) {}

  @Process('send-reminder')
  async handleReminder(job: Job<InvoiceReminderJobData>) {
    const { invoiceId, userId, userEmail, userName, amount, dueDate, tokenType } = job.data;

    this.logger.log(`Processing invoice reminder for invoice ${invoiceId}`);

    try {
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
        message: `Your invoice ${invoiceId} for ${amount} ${tokenType} is due on ${dueDate.toLocaleDateString()}.`,
        metadata: {
          invoiceId,
          amount,
          dueDate,
          tokenType,
        },
      });

      this.logger.log(`Successfully sent reminder for invoice ${invoiceId}`);
      return { success: true, invoiceId };
    } catch (error) {
      this.logger.error(`Failed to send reminder for invoice ${invoiceId}`, error.stack);
      throw error;
    }
  }

  @OnQueueActive()
  onActive(job: Job) {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);
  }

  @OnQueueCompleted()
  onCompleted(job: Job, result: any) {
    this.logger.log(`Completed job ${job.id} of type ${job.name}. Result: ${JSON.stringify(result)}`);
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(
      `Failed job ${job.id} of type ${job.name}. Error: ${error.message}`,
      error.stack,
    );
  }
}
