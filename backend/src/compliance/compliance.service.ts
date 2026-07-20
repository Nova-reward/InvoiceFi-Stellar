import { Injectable, Logger } from '@nestjs/common';
import { Invoice } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ErasureRequestDto } from './dto/compliance.dto';

const RETENTION_WINDOW_DAYS = 365;
const RETENTION_WINDOW_MS = RETENTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;

@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async exportPersonalData(userId: string) {
    const records = await this.prisma.invoice.findMany({
      where: {
        OR: [{ farmer: userId }, { investor: userId }],
      },
    });

    return {
      userId,
      exportedAt: new Date().toISOString(),
      recordCount: records.length,
      records: records.map((invoice) => this.toExportRecord(invoice)),
    };
  }

  async requestErasure(dto: ErasureRequestDto) {
    const records = await this.prisma.invoice.findMany({
      where: {
        OR: [{ farmer: dto.userId }, { investor: dto.userId }],
      },
    });

    let pseudonymizedRecordCount = 0;

    for (const invoice of records) {
      const updates: Record<string, string> = {};

      if (invoice.farmer === dto.userId) {
        updates.farmer = this.pseudonymizeField('farmer', invoice.id);
      }

      if (invoice.investor === dto.userId) {
        updates.investor = this.pseudonymizeField('investor', invoice.id);
      }

      if (Object.keys(updates).length > 0) {
        await this.prisma.invoice.updateMany({
          where: { id: invoice.id },
          data: updates,
        });
        pseudonymizedRecordCount += 1;
      }
    }

    return {
      receiptId: `erasure-${Date.now()}`,
      status: 'completed',
      userId: dto.userId,
      reason: dto.reason,
      pseudonymizedRecordCount,
      preservedOnChainLinkage: true,
    };
  }

  async cleanupExpiredRecords() {
    const cutoff = new Date(Date.now() - RETENTION_WINDOW_MS);
    const expiredRecords = await this.prisma.invoice.findMany({
      where: {
        OR: [
          { createdAt: { lte: cutoff } },
          { settledAt: { lte: cutoff } },
        ],
      },
    });

    let processedRecords = 0;

    for (const invoice of expiredRecords) {
      const updates: Record<string, string> = {};

      if (invoice.farmer) {
        updates.farmer = this.pseudonymizeField('farmer', invoice.id);
      }

      if (invoice.investor) {
        updates.investor = this.pseudonymizeField('investor', invoice.id);
      }

      if (Object.keys(updates).length > 0) {
        await this.prisma.invoice.updateMany({
          where: { id: invoice.id },
          data: updates,
        });
        processedRecords += 1;
      }
    }

    this.logger.log(
      `Retention cleanup completed. Pseudonymized ${processedRecords} expired invoice records.`,
    );

    return {
      processedRecords,
      retentionWindowDays: RETENTION_WINDOW_DAYS,
    };
  }

  private toExportRecord(invoice: Invoice) {
    return {
      id: invoice.id,
      onchainId: invoice.onchainId.toString(),
      status: invoice.status,
      faceValue: invoice.faceValue.toString(),
      farmer: invoice.farmer,
      investor: invoice.investor,
      settledLedger: invoice.settledLedger,
      settledAt: invoice.settledAt?.toISOString() ?? null,
      createdAt: invoice.createdAt.toISOString(),
      updatedAt: invoice.updatedAt.toISOString(),
    };
  }

  private pseudonymizeField(field: 'farmer' | 'investor', invoiceId: number) {
    return `${field}-redacted-${invoiceId}`;
  }
}
