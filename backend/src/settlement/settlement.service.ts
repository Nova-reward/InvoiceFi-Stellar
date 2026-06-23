import { Injectable, Logger } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export enum SettlementResult {
  /** The invoice transitioned FUNDED -> REPAID. */
  SETTLED = 'settled',
  /** The invoice was already REPAID (event replayed / retried). */
  ALREADY_REPAID = 'already_repaid',
}

/** The invoice referenced by an event is not (yet) mirrored in the database. */
export class InvoiceNotFoundError extends Error {
  constructor(invoiceId: string) {
    super(`Invoice ${invoiceId} not found in database`);
    this.name = 'InvoiceNotFoundError';
  }
}

/** The invoice exists but is not in a settleable (FUNDED) state. */
export class UnexpectedInvoiceStatusError extends Error {
  constructor(invoiceId: string, status: InvoiceStatus) {
    super(`Invoice ${invoiceId} is ${status}, expected FUNDED`);
    this.name = 'UnexpectedInvoiceStatusError';
  }
}

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Apply an on-chain settlement to the database, transitioning the invoice
   * from FUNDED to REPAID atomically.
   *
   * The write is a single conditional `updateMany` guarded on `status = FUNDED`,
   * so concurrent calls cannot double-apply. The operation is idempotent: a
   * replayed or retried event for an already-REPAID invoice resolves to
   * {@link SettlementResult.ALREADY_REPAID} instead of erroring.
   */
  async settleInvoice(
    invoiceId: string,
    ledger: number,
  ): Promise<SettlementResult> {
    const onchainId = BigInt(invoiceId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.invoice.updateMany({
        where: { onchainId, status: InvoiceStatus.FUNDED },
        data: {
          status: InvoiceStatus.REPAID,
          settledLedger: ledger,
          settledAt: new Date(),
        },
      });

      if (updated.count > 0) {
        this.logger.log(
          `Invoice ${invoiceId} settled (FUNDED -> REPAID) at ledger ${ledger}`,
        );
        return SettlementResult.SETTLED;
      }

      // No row moved — figure out why so the caller can decide on retries.
      const existing = await tx.invoice.findUnique({ where: { onchainId } });
      if (!existing) {
        throw new InvoiceNotFoundError(invoiceId);
      }
      if (existing.status === InvoiceStatus.REPAID) {
        this.logger.debug(
          `Invoice ${invoiceId} already REPAID; skipping (idempotent).`,
        );
        return SettlementResult.ALREADY_REPAID;
      }
      throw new UnexpectedInvoiceStatusError(invoiceId, existing.status);
    });
  }
}
