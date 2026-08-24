/**
 * Tests for durable cursor writes, crash-recovery, and gap detection in
 * SettlementSyncService.
 *
 * Coverage:
 *  - Cursor is written inside the same transaction as the invoice settlement
 *  - Crash-after-apply / before-cursor-write causes idempotent re-processing
 *  - Gap detection fires a structured alert when ledger sequence is discontinuous
 *  - Backfill re-processes a range without touching the live cursor
 *  - Backfill is idempotent (ALREADY_REPAID does not error)
 */

import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SettlementResult, SettlementService } from './settlement.service';
import { SettlementSyncService } from './settlement-sync.service';
import { SorobanEventsService } from './soroban-events.service';
import { SyncCursorService } from './sync-cursor.service';
import { NormalizedEvent } from './types';

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  prisma: { $transaction: jest.Mock };
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

  // The prisma.$transaction mock executes the callback with a fake tx object
  // that has a syncCursor model, mirroring the interactive-transaction API.
  const fakeTx = { syncCursor: { upsert: jest.fn().mockResolvedValue({}) } };
  const prisma = {
    $transaction: jest.fn(async (cb: (tx: typeof fakeTx) => unknown) => cb(fakeTx)),
  };

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
    prisma as unknown as PrismaService,
    {} as SchedulerRegistry,
    config,
  );
  return { service, events, settlement, cursor, prisma };
}

// ── Durable cursor (transactional write) ─────────────────────────────────────

describe('SettlementSyncService — durable cursor writes', () => {
  it('wraps settleInvoiceWithTx + setLastLedger in a single $transaction per event', async () => {
    const { service, events, settlement, cursor, prisma } = build();
    cursor.getLastLedger.mockResolvedValue(100);
    events.fetchEvents.mockResolvedValue({
      // Ledger 101 is contiguous with cursor 100 — no gap alert.
      events: [settlementEvent('7', 101)],
      latestLedger: 110,
    });
    settlement.settleInvoiceWithTx.mockResolvedValue(SettlementResult.SETTLED);

    const summary = await service.syncOnce();

    // One $transaction call for the settlement event.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // settleInvoiceWithTx was called inside the transaction.
    expect(settlement.settleInvoiceWithTx).toHaveBeenCalledWith('7', 101, expect.anything());
    // cursor.setLastLedger is still called at the end to advance to the network tip.
    expect(cursor.setLastLedger).toHaveBeenCalledWith(110);
    expect(summary).toEqual({ processed: 1, settled: 1, gaps: 0 });
  });

  it('calls setLastLedger with the tx client inside the per-event transaction', async () => {
    const { service, events, settlement, cursor, prisma } = build();
    cursor.getLastLedger.mockResolvedValue(100);
    events.fetchEvents.mockResolvedValue({
      // Contiguous — no gap alert.
      events: [settlementEvent('42', 101)],
      latestLedger: 101,
    });
    settlement.settleInvoiceWithTx.mockResolvedValue(SettlementResult.SETTLED);

    // Spy: collect every (ledger, tx?) call made to setLastLedger.
    const setLastLedgerCalls: Array<[number, unknown]> = [];
    cursor.setLastLedger.mockImplementation(
      async (ledger: number, tx?: unknown) => {
        setLastLedgerCalls.push([ledger, tx]);
      },
    );

    // Override $transaction to inject a known fakeTx into the callback so we
    // can assert it was forwarded to cursor.setLastLedger.
    const fakeTx = { syncCursor: { upsert: jest.fn() } };
    prisma.$transaction.mockImplementation(
      async (cb: (tx: typeof fakeTx) => unknown) => cb(fakeTx),
    );

    await service.syncOnce();

    // At least one call to cursor.setLastLedger must carry a defined tx
    // argument (the one inside applyEventAtomically).
    const transactionalCall = setLastLedgerCalls.find(([, tx]) => tx !== undefined);
    expect(transactionalCall).toBeDefined();
    expect(transactionalCall![1]).toBe(fakeTx);
  });
});

// ── Crash-recovery / idempotency ─────────────────────────────────────────────

describe('SettlementSyncService — crash-recovery', () => {
  it('re-processes an event idempotently when cursor was not advanced (simulated crash)', async () => {
    const { service, events, settlement, cursor } = build();

    // Simulate: last cursor = 104 (last fully processed ledger),
    // but event at ledger 105 was applied before crash (cursor not yet advanced).
    cursor.getLastLedger.mockResolvedValue(104);
    events.fetchEvents.mockResolvedValue({
      events: [settlementEvent('7', 105)],
      latestLedger: 105,
    });
    // Invoice is already settled (idempotent path).
    settlement.settleInvoiceWithTx.mockResolvedValue(SettlementResult.ALREADY_REPAID);

    const summary = await service.syncOnce();

    // Event was re-processed without error.
    expect(settlement.settleInvoiceWithTx).toHaveBeenCalledWith('7', 105, expect.anything());
    // settled count is 0 (idempotent), but processed count is 1.
    expect(summary.processed).toBe(1);
    expect(summary.settled).toBe(0);
    // Cursor advanced past the event.
    expect(cursor.setLastLedger).toHaveBeenCalledWith(105);
  });

  it('does not count an already-repaid invoice as newly settled', async () => {
    const { service, events, cursor, settlement } = build();
    cursor.getLastLedger.mockResolvedValue(100);
    events.fetchEvents.mockResolvedValue({
      events: [settlementEvent('7', 101)],
      latestLedger: 101,
    });
    settlement.settleInvoiceWithTx.mockResolvedValue(SettlementResult.ALREADY_REPAID);

    const summary = await service.syncOnce();

    expect(summary).toMatchObject({ processed: 1, settled: 0 });
    expect(cursor.setLastLedger).toHaveBeenCalledWith(101);
  });

  it('holds the cursor at the last good ledger when an event permanently fails', async () => {
    const { service, events, settlement, cursor } = build();
    cursor.getLastLedger.mockResolvedValue(100);
    events.fetchEvents.mockResolvedValue({
      events: [settlementEvent('7', 101)],
      latestLedger: 110,
    });
    settlement.settleInvoiceWithTx.mockRejectedValue(new Error('permanent'));

    const summary = await service.syncOnce();

    expect(settlement.settleInvoiceWithTx).toHaveBeenCalledTimes(3); // 3 maxAttempts
    expect(summary).toMatchObject({ processed: 1, settled: 0 });
    // Cursor NOT advanced past the failing event — held at last safe ledger.
    expect(cursor.setLastLedger).toHaveBeenCalledWith(100);
  });

  it('retries a transiently-failing settlement before succeeding', async () => {
    const { service, events, settlement, cursor } = build();
    cursor.getLastLedger.mockResolvedValue(100);
    events.fetchEvents.mockResolvedValue({
      events: [settlementEvent('7', 101)],
      latestLedger: 101,
    });
    settlement.settleInvoiceWithTx
      .mockRejectedValueOnce(new Error('db timeout'))
      .mockResolvedValueOnce(SettlementResult.SETTLED);

    const summary = await service.syncOnce();

    expect(settlement.settleInvoiceWithTx).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({ processed: 1, settled: 1 });
    expect(cursor.setLastLedger).toHaveBeenCalledWith(101);
  });
});

// ── Gap detection ─────────────────────────────────────────────────────────────

describe('SettlementSyncService — gap detection', () => {
  it('emits a structured warn when the first event ledger is non-contiguous with the cursor', async () => {
    const { service, events, cursor, settlement } = build();
    cursor.getLastLedger.mockResolvedValue(100);
    events.fetchEvents.mockResolvedValue({
      // Gap: expected next ledger is 101, got 105.
      events: [settlementEvent('7', 105)],
      latestLedger: 110,
    });
    settlement.settleInvoiceWithTx.mockResolvedValue(SettlementResult.SETTLED);

    const warnSpy = jest.spyOn(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).logger,
      'warn',
    );

    const summary = await service.syncOnce();

    expect(summary.gaps).toBe(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [warnArg] = warnSpy.mock.calls[0];
    const parsed = JSON.parse(warnArg as string);
    expect(parsed.event).toBe('ledger_gap_detected');
    expect(parsed.expectedLedger).toBe(101);
    expect(parsed.actualLedger).toBe(105);
    expect(parsed.missedLedgers).toBe(4);
  });

  it('emits a warn for an internal gap within the same batch', async () => {
    const { service, events, cursor } = build();
    cursor.getLastLedger.mockResolvedValue(100);
    events.fetchEvents.mockResolvedValue({
      // Start contiguous at 101, then gap at 103→110.
      events: [
        otherEvent(101),
        otherEvent(103),
        otherEvent(110),
      ],
      latestLedger: 110,
    });

    const warnSpy = jest.spyOn(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).logger,
      'warn',
    );

    const summary = await service.syncOnce();

    // At least one internal gap (103→110).
    expect(summary.gaps).toBeGreaterThanOrEqual(1);
    const warnMessages = warnSpy.mock.calls.map(([arg]) => JSON.parse(arg as string));
    expect(warnMessages.some((m) => m.event === 'ledger_gap_detected')).toBe(true);
  });

  it('does not emit a gap warn when ledgers are contiguous', async () => {
    const { service, events, cursor, settlement } = build();
    cursor.getLastLedger.mockResolvedValue(100);
    events.fetchEvents.mockResolvedValue({
      events: [otherEvent(101), otherEvent(102), settlementEvent('7', 103)],
      latestLedger: 103,
    });
    settlement.settleInvoiceWithTx.mockResolvedValue(SettlementResult.SETTLED);

    const warnSpy = jest.spyOn(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).logger,
      'warn',
    );

    const summary = await service.syncOnce();

    expect(summary.gaps).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not emit a gap warn on first run (lastLedger = 0)', async () => {
    const { service, events, cursor } = build();
    cursor.getLastLedger.mockResolvedValue(0);
    events.getLatestLedger.mockResolvedValue(500);
    events.fetchEvents.mockResolvedValue({
      events: [otherEvent(510)],
      latestLedger: 510,
    });

    const warnSpy = jest.spyOn(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).logger,
      'warn',
    );

    await service.syncOnce();

    // Gap suppressed on first run — no stored cursor to compare against.
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ── Backfill ──────────────────────────────────────────────────────────────────

describe('SettlementSyncService — backfill', () => {
  it('processes events in range and returns the correct summary', async () => {
    const { service, events, settlement, cursor } = build();
    events.fetchEvents.mockResolvedValue({
      events: [
        settlementEvent('1', 200),
        settlementEvent('2', 201),
        settlementEvent('3', 205), // outside range — should be excluded
      ],
      latestLedger: 210,
    });
    settlement.settleInvoice.mockResolvedValue(SettlementResult.SETTLED);

    const summary = await service.backfill(200, 202);

    // Only events in [200, 202] are processed.
    expect(settlement.settleInvoice).toHaveBeenCalledTimes(2);
    expect(settlement.settleInvoice).toHaveBeenCalledWith('1', 200);
    expect(settlement.settleInvoice).toHaveBeenCalledWith('2', 201);
    expect(summary).toMatchObject({ processed: 2, settled: 2 });
    // cursor referenced but not modified.
    expect(cursor.setLastLedger).not.toHaveBeenCalled();
  });

  it('does NOT update the live cursor during backfill', async () => {
    const { service, events, settlement, cursor } = build();
    events.fetchEvents.mockResolvedValue({
      events: [settlementEvent('1', 200)],
      latestLedger: 210,
    });
    settlement.settleInvoice.mockResolvedValue(SettlementResult.SETTLED);

    await service.backfill(200, 200);

    // cursor.setLastLedger must never be called during backfill.
    expect(cursor.setLastLedger).not.toHaveBeenCalled();
  });

  it('is idempotent — ALREADY_REPAID events do not cause errors', async () => {
    const { service, events, settlement } = build();
    events.fetchEvents.mockResolvedValue({
      events: [settlementEvent('7', 200), settlementEvent('8', 201)],
      latestLedger: 210,
    });
    settlement.settleInvoice
      .mockResolvedValueOnce(SettlementResult.ALREADY_REPAID)
      .mockResolvedValueOnce(SettlementResult.SETTLED);

    const summary = await service.backfill(200, 201);

    expect(summary.processed).toBe(2);
    expect(summary.settled).toBe(1); // Only the SETTLED one counts.
  });

  it('continues processing subsequent events when one event in the range fails permanently', async () => {
    const { service, events, settlement } = build();
    events.fetchEvents.mockResolvedValue({
      events: [
        // Use valid numeric invoice IDs so parseSettlementEvent accepts them.
        settlementEvent('100', 200),
        settlementEvent('101', 201),
      ],
      latestLedger: 210,
    });
    // Reject all 3 attempts for invoice 100, then settle invoice 101.
    settlement.settleInvoice
      .mockRejectedValueOnce(new Error('permanent failure'))
      .mockRejectedValueOnce(new Error('permanent failure'))
      .mockRejectedValueOnce(new Error('permanent failure'))
      .mockResolvedValueOnce(SettlementResult.SETTLED);

    const summary = await service.backfill(200, 201);

    // 3 failed attempts for '100', 1 successful call for '101'.
    expect(settlement.settleInvoice).toHaveBeenCalledTimes(4);
    expect(settlement.settleInvoice).toHaveBeenCalledWith('101', 201);
    expect(summary.processed).toBe(2);
    expect(summary.settled).toBe(1);
  });

  it('uses the latest ledger as start on first run (empty cursor)', async () => {
    const { service, events, cursor } = build();
    cursor.getLastLedger.mockResolvedValue(0);
    events.getLatestLedger.mockResolvedValue(500);
    events.fetchEvents.mockResolvedValue({ events: [], latestLedger: 500 });

    const summary = await service.syncOnce();

    expect(events.getLatestLedger).toHaveBeenCalled();
    expect(events.fetchEvents).toHaveBeenCalledWith(500);
    expect(summary).toMatchObject({ processed: 0, settled: 0, gaps: 0 });
    expect(cursor.setLastLedger).toHaveBeenCalledWith(500);
  });
});
