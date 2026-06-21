import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });
  }

  async sendInvoiceReminder(data: {
    to: string;
    userName: string;
    invoiceId: string;
    amount: string;
    dueDate: Date;
    tokenType: string;
  }) {
    const { to, userName, invoiceId, amount, dueDate, tokenType } = data;

    const formattedDate = dueDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@invoicefi.com',
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

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log(`Email sent successfully: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('Error sending email:', error);
      throw error;
    }
  }
}
