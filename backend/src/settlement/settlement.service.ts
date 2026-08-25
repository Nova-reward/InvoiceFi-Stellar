import { Injectable, Logger } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookDispatchService } from '../webhooks/webhook-dispatch.service';
import { appendInvoiceEvent } from '../invoices/invoice-event.service';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhookDispatch: WebhookDispatchService,
  ) {}

  /**
   * Apply an on-chain settlement to the database, transitioning the invoice
   * from FUNDED to REPAID atomically.
   *
   * The write is a single conditional `updateMany` guarded on `status = FUNDED`,
   * so concurrent calls cannot double-apply. The operation is idempotent: a
   * replayed or retried event for an already-REPAID invoice resolves to
   * {@link SettlementResult.ALREADY_REPAID} instead of erroring.
   *
   * On a fresh settlement, enqueues a `repaid` webhook event for any
   * registered subscribers. Enqueueing only writes a queue row (see
   * `WebhookDispatchService`), so a broken subscriber can never fail or
   * delay settlement itself.
   */
  async settleInvoice(
    invoiceId: string,
    ledger: number,
    txHash?: string,
  ): Promise<SettlementResult> {
    const onchainId = BigInt(invoiceId);

    const result = await this.prisma.db.$transaction(async (tx) => {
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
        await appendInvoiceEvent(tx, {
          invoiceOnchainId: onchainId,
          previousStatus: InvoiceStatus.FUNDED,
          newStatus: InvoiceStatus.REPAID,
          actorId: 'settlement-sync-service',
          txHash,
        });
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

    if (result === SettlementResult.SETTLED) {
      await this.webhookDispatch.dispatchInvoiceEvent({
        invoiceId,
        event: 'repaid',
        timestamp: new Date().toISOString(),
        data: { ledger },
      });
    }

    return result;
  }
}
