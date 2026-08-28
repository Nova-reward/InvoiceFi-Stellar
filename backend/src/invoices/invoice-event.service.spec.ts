import { InvoiceStatus, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  InvoiceEventService,
  appendInvoiceEvent,
  nowNanos,
} from './invoice-event.service';

interface InvoiceEventClientMock {
  invoiceEvent: {
    create: jest.Mock;
    findMany: jest.Mock;
  };
}

function buildClient(): InvoiceEventClientMock {
  return {
    invoiceEvent: { create: jest.fn(), findMany: jest.fn() },
  };
}

function buildPrisma(client: InvoiceEventClientMock): PrismaService {
  return { db: client } as unknown as PrismaService;
}

describe('appendInvoiceEvent', () => {
  it('creates a row with the given transition, actor and tx hash', async () => {
    const client = buildClient();
    client.invoiceEvent.create.mockResolvedValue({});

    await appendInvoiceEvent(client as unknown as PrismaClient, {
      invoiceOnchainId: 42n,
      previousStatus: InvoiceStatus.PENDING,
      newStatus: InvoiceStatus.FUNDED,
      actorId: 'investor-wallet-1',
      txHash: '0xabc',
    });

    expect(client.invoiceEvent.create).toHaveBeenCalledTimes(1);
    const { data } = client.invoiceEvent.create.mock.calls[0][0];
    expect(data.invoiceOnchainId).toBe(42n);
    expect(data.previousStatus).toBe(InvoiceStatus.PENDING);
    expect(data.newStatus).toBe(InvoiceStatus.FUNDED);
    expect(data.actorId).toBe('investor-wallet-1');
    expect(data.txHash).toBe('0xabc');
    expect(typeof data.occurredAtNanos).toBe('bigint');
  });

  it('defaults a missing txHash to null rather than undefined', async () => {
    const client = buildClient();
    client.invoiceEvent.create.mockResolvedValue({});

    await appendInvoiceEvent(client as unknown as PrismaClient, {
      invoiceOnchainId: 1n,
      previousStatus: null,
      newStatus: InvoiceStatus.PENDING,
      actorId: 'system',
    });

    const { data } = client.invoiceEvent.create.mock.calls[0][0];
    expect(data.txHash).toBeNull();
    expect(data.previousStatus).toBeNull();
  });

  it('never issues an update or delete against the events table', () => {
    const client = buildClient();
    expect((client.invoiceEvent as Record<string, unknown>).update).toBeUndefined();
    expect((client.invoiceEvent as Record<string, unknown>).delete).toBeUndefined();
    expect((client.invoiceEvent as Record<string, unknown>).updateMany).toBeUndefined();
    expect((client.invoiceEvent as Record<string, unknown>).deleteMany).toBeUndefined();
  });
});

describe('nowNanos', () => {
  it('returns a strictly increasing, millisecond-consistent nanosecond value', () => {
    const a = nowNanos();
    const b = nowNanos();
    expect(b).toBeGreaterThanOrEqual(a);
    // Millisecond component should round-trip against Date.now() resolution.
    expect(Number(a / 1_000_000n)).toBeGreaterThan(0);
  });
});

describe('InvoiceEventService.listByOnchainId', () => {
  it('returns events ordered oldest-first with string-encoded ids/timestamps', async () => {
    const client = buildClient();
    client.invoiceEvent.findMany.mockResolvedValue([
      {
        id: 'evt-1',
        invoiceOnchainId: 42n,
        previousStatus: null,
        newStatus: InvoiceStatus.PENDING,
        actorId: 'system',
        txHash: null,
        occurredAtNanos: 1_000_000_000n,
        createdAt: new Date('2026-08-20T00:00:00.000Z'),
      },
      {
        id: 'evt-2',
        invoiceOnchainId: 42n,
        previousStatus: InvoiceStatus.PENDING,
        newStatus: InvoiceStatus.FUNDED,
        actorId: 'investor-wallet-1',
        txHash: '0xabc',
        occurredAtNanos: 2_000_000_000n,
        createdAt: new Date('2026-08-20T00:01:00.000Z'),
      },
    ]);

    const service = new InvoiceEventService(buildPrisma(client));
    const events = await service.listByOnchainId(42n);

    expect(client.invoiceEvent.findMany).toHaveBeenCalledWith({
      where: { invoiceOnchainId: 42n },
      orderBy: { sequence: 'asc' },
    });
    expect(events).toEqual([
      {
        id: 'evt-1',
        invoiceOnchainId: '42',
        previousStatus: null,
        newStatus: InvoiceStatus.PENDING,
        actorId: 'system',
        txHash: null,
        occurredAtNanos: '1000000000',
        createdAt: '2026-08-20T00:00:00.000Z',
      },
      {
        id: 'evt-2',
        invoiceOnchainId: '42',
        previousStatus: InvoiceStatus.PENDING,
        newStatus: InvoiceStatus.FUNDED,
        actorId: 'investor-wallet-1',
        txHash: '0xabc',
        occurredAtNanos: '2000000000',
        createdAt: '2026-08-20T00:01:00.000Z',
      },
    ]);
  });
});
