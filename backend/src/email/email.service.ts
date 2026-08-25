import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { VaultService } from '../config/vault/vault.service';

interface SendInvoiceReminderParams {
  to: string;
  userName: string;
  invoiceId: string;
  amount: string;
  dueDate: Date;
  tokenType: string;
}

interface SendMailResult {
  success: boolean;
  messageId: string;
}

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter!: nodemailer.Transporter;

  constructor(private readonly vault: VaultService) {}

  onModuleInit(): void {
    // SMTP credentials are sourced from Vault, not process.env.
    const smtp = this.vault.smtp;
    this.transporter = nodemailer.createTransport({
      host: smtp.host,
      port: parseInt(smtp.port, 10),
      secure: smtp.secure === 'true',
      auth: {
        user: smtp.user,
        pass: smtp.password,
      },
    });
  }

  async sendInvoiceReminder(
    data: SendInvoiceReminderParams,
  ): Promise<SendMailResult> {
    const { to, userName, invoiceId, amount, dueDate, tokenType } = data;

    const formattedDate = dueDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const mailOptions = {
      from: this.vault.smtp.from,
      to,
      subject: `Invoice Payment Reminder - Due on ${formattedDate}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Invoice Payment Reminder</h2>
          <p>Dear ${userName},</p>
          <p>This is a friendly reminder that your invoice is due soon.</p>
          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Invoice ID:</strong> ${invoiceId}</p>
            <p><strong>Amount Due:</strong> ${amount} ${tokenType}</p>
            <p><strong>Due Date:</strong> ${formattedDate}</p>
          </div>
          <p>Please ensure that your payment is processed before the due date to avoid any late fees.</p>
          <p>If you have already made the payment, please disregard this notice.</p>
          <p>Best regards,<br/>InvoiceFi Team</p>
        </div>
      `,
    };

    const info = await this.transporter.sendMail(mailOptions);
    this.logger.log(`Email sent: ${info.messageId}`);
    return { success: true, messageId: info.messageId as string };
  }
}
