import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SettlementResult, SettlementService } from './settlement.service';
import { SettlementSyncService } from './settlement-sync.service';
import { SorobanEventsService } from './soroban-events.service';
import { SyncCursorService } from './sync-cursor.service';
import { NormalizedEvent } from './types';

function settlementEvent(invoiceId: string, ledger: number): NormalizedEvent {
  return {
    ledger,
    contractId: 'C_INVOICE',
    topics: ['invoice_settled', invoiceId],
    value: null,
  };
}

function otherEvent(ledger: number): NormalizedEvent {
  return { ledger, contractId: 'C_INVOICE', topics: ['mint', '1'], value: null };
}

interface Mocks {
  events: jest.Mocked<Pick<SorobanEventsService, 'fetchEvents' | 'getLatestLedger'>>;
  settlement: jest.Mocked<Pick<SettlementService, 'settleInvoice' | 'settleInvoiceWithTx'>>;
  cursor: jest.Mocked<Pick<SyncCursorService, 'getLastLedger' | 'setLastLedger'>>;
}

function build(): { service: SettlementSyncService } & Mocks {
  const events = {
    fetchEvents: jest.fn(),
    getLatestLedger: jest.fn(),
  };
  const settlement = {
    settleInvoice: jest.fn(),
    settleInvoiceWithTx: jest.fn(),
  };
  const cursor = {
    getLastLedger: jest.fn(),
    setLastLedger: jest.fn().mockResolvedValue(undefined),
  };

  // Prisma mock: $transaction executes the callback with a fake tx object.
  const fakeTx = { syncCursor: { upsert: jest.fn().mockResolvedValue({}) } };
  const prisma = {
    $transaction: jest.fn(async (cb: (tx: typeof fakeTx) => unknown) => cb(fakeTx)),
  } as unknown as PrismaService;

  const config = {
    get: (key: string) =>
      ({
        SETTLEMENT_MAX_ATTEMPTS: 3,
        SETTLEMENT_RETRY_BASE_MS: 1,
        SETTLEMENT_POLL_INTERVAL_MS: 5_000,
      })[key],
  } as unknown as ConfigService;

  const service = new SettlementSyncService(
    events as unknown as SorobanEventsService,
    settlement as unknown as SettlementService,
    cursor as unknown as SyncCursorService,
    prisma,
    {} as SchedulerRegistry,
    config,
  );
  return { service, events, settlement, cursor };
}

describe('SettlementSyncService.syncOnce', () => {
  it('settles events and advances the cursor to the network tip', async () => {
    const { service, events, settlement, cursor } = build();
    cursor.getLastLedger.mockResolvedValue(100);
    events.fetchEvents.mockResolvedValue({
      events: [settlementEvent('7', 105), otherEvent(106)],
      latestLedger: 110,
    });
    settlement.settleInvoiceWithTx.mockResolvedValue(SettlementResult.SETTLED);

    const summary = await service.syncOnce();

    expect(events.fetchEvents).toHaveBeenCalledWith(101);
    expect(settlement.settleInvoice).toHaveBeenCalledWith('7', 105, undefined);
    expect(summary).toEqual({ processed: 1, settled: 1 });
    expect(cursor.setLastLedger).toHaveBeenCalledWith(110);
  });

  it('uses the latest ledger as the start on first run (empty cursor)', async () => {
    const { service, events, cursor } = build();
    cursor.getLastLedger.mockResolvedValue(0);
    events.getLatestLedger.mockResolvedValue(500);
    events.fetchEvents.mockResolvedValue({ events: [], latestLedger: 500 });

    const summary = await service.syncOnce();

    expect(events.getLatestLedger).toHaveBeenCalled();
    expect(events.fetchEvents).toHaveBeenCalledWith(500);
    expect(summary).toMatchObject({ processed: 0, settled: 0 });
    expect(cursor.setLastLedger).toHaveBeenCalledWith(500);
  });

  it('does not count an already-repaid invoice as newly settled', async () => {
    const { service, events, cursor, settlement } = build();
    cursor.getLastLedger.mockResolvedValue(100);
    events.fetchEvents.mockResolvedValue({
      events: [settlementEvent('7', 105)],
      latestLedger: 105,
    });
    settlement.settleInvoiceWithTx.mockResolvedValue(SettlementResult.ALREADY_REPAID);

    const summary = await service.syncOnce();

    expect(summary).toMatchObject({ processed: 1, settled: 0 });
    expect(cursor.setLastLedger).toHaveBeenCalledWith(105);
  });

  it('retries a transiently-failing settlement before succeeding', async () => {
    const { service, events, settlement, cursor } = build();
    cursor.getLastLedger.mockResolvedValue(100);
    events.fetchEvents.mockResolvedValue({
      events: [settlementEvent('7', 105)],
      latestLedger: 105,
    });
    settlement.settleInvoiceWithTx
      .mockRejectedValueOnce(new Error('db timeout'))
      .mockResolvedValueOnce(SettlementResult.SETTLED);

    const summary = await service.syncOnce();

    expect(settlement.settleInvoiceWithTx).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({ processed: 1, settled: 1 });
    expect(cursor.setLastLedger).toHaveBeenCalledWith(105);
  });

  it('stops at the last good ledger when an event keeps failing', async () => {
    const { service, events, settlement, cursor } = build();
    cursor.getLastLedger.mockResolvedValue(100);
    events.fetchEvents.mockResolvedValue({
      events: [settlementEvent('7', 105)],
      latestLedger: 110,
    });
    settlement.settleInvoiceWithTx.mockRejectedValue(new Error('permanent'));

    const summary = await service.syncOnce();

    // 3 attempts via withRetry, then give up.
    expect(settlement.settleInvoiceWithTx).toHaveBeenCalledTimes(3);
    expect(summary).toMatchObject({ processed: 1, settled: 0 });
    // Cursor held at startLedger-1 so the event is re-fetched next cycle.
    expect(cursor.setLastLedger).toHaveBeenCalledWith(100);
  });
});
