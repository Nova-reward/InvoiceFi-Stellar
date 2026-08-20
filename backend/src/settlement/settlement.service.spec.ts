import { InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookDispatchService } from '../webhooks/webhook-dispatch.service';
import {
  InvoiceNotFoundError,
  SettlementResult,
  SettlementService,
  UnexpectedInvoiceStatusError,
} from './settlement.service';

interface TxMock {
  invoice: {
    updateMany: jest.Mock;
    findUnique: jest.Mock;
  };
}

function buildPrisma(tx: TxMock): { prisma: PrismaService; tx: TxMock } {
  const prisma = {
    db: { $transaction: jest.fn((cb: (t: TxMock) => unknown) => cb(tx)) },
  } as unknown as PrismaService;
  return { prisma, tx };
}

function buildWebhookDispatch(): WebhookDispatchService {
  return {
    dispatchInvoiceEvent: jest.fn().mockResolvedValue(0),
  } as unknown as WebhookDispatchService;
}

describe('SettlementService', () => {
  const tx: TxMock = {
    invoice: { updateMany: jest.fn(), findUnique: jest.fn() },
  };

  beforeEach(() => {
    tx.invoice.updateMany.mockReset();
    tx.invoice.findUnique.mockReset();
  });

  it('transitions FUNDED -> REPAID atomically and records ledger/time', async () => {
    tx.invoice.updateMany.mockResolvedValue({ count: 1 });
    const { prisma } = buildPrisma(tx);
    const webhookDispatch = buildWebhookDispatch();
    const service = new SettlementService(prisma, webhookDispatch);

    const result = await service.settleInvoice('7', 4242);

    expect(result).toBe(SettlementResult.SETTLED);
    const args = tx.invoice.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({
      onchainId: 7n,
      status: InvoiceStatus.FUNDED,
    });
    expect(args.data.status).toBe(InvoiceStatus.REPAID);
    expect(args.data.settledLedger).toBe(4242);
    expect(args.data.settledAt).toBeInstanceOf(Date);
    // Never had to look the invoice up — the conditional update did the work.
    expect(tx.invoice.findUnique).not.toHaveBeenCalled();
  });

  it('enqueues a "repaid" webhook event on a fresh settlement', async () => {
    tx.invoice.updateMany.mockResolvedValue({ count: 1 });
    const { prisma } = buildPrisma(tx);
    const webhookDispatch = buildWebhookDispatch();
    const service = new SettlementService(prisma, webhookDispatch);

    await service.settleInvoice('7', 4242);

    expect(webhookDispatch.dispatchInvoiceEvent).toHaveBeenCalledTimes(1);
    expect(webhookDispatch.dispatchInvoiceEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceId: '7',
        event: 'repaid',
        data: { ledger: 4242 },
      }),
    );
  });

  it('is idempotent when the invoice is already REPAID, and does not re-dispatch', async () => {
    tx.invoice.updateMany.mockResolvedValue({ count: 0 });
    tx.invoice.findUnique.mockResolvedValue({ status: InvoiceStatus.REPAID });
    const { prisma } = buildPrisma(tx);
    const webhookDispatch = buildWebhookDispatch();
    const service = new SettlementService(prisma, webhookDispatch);

    await expect(service.settleInvoice('7', 1)).resolves.toBe(
      SettlementResult.ALREADY_REPAID,
    );
    expect(webhookDispatch.dispatchInvoiceEvent).not.toHaveBeenCalled();
  });

  it('throws InvoiceNotFoundError when the invoice is absent', async () => {
    tx.invoice.updateMany.mockResolvedValue({ count: 0 });
    tx.invoice.findUnique.mockResolvedValue(null);
    const { prisma } = buildPrisma(tx);
    const service = new SettlementService(prisma, buildWebhookDispatch());

    await expect(service.settleInvoice('7', 1)).rejects.toBeInstanceOf(
      InvoiceNotFoundError,
    );
  });

  it('throws UnexpectedInvoiceStatusError for a non-FUNDED invoice', async () => {
    tx.invoice.updateMany.mockResolvedValue({ count: 0 });
    tx.invoice.findUnique.mockResolvedValue({ status: InvoiceStatus.PENDING });
    const { prisma } = buildPrisma(tx);
    const service = new SettlementService(prisma, buildWebhookDispatch());

    await expect(service.settleInvoice('7', 1)).rejects.toBeInstanceOf(
      UnexpectedInvoiceStatusError,
    );
  });
});
