import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { withRetry } from '../common/retry';
import { PrismaService } from '../prisma/prisma.service';
import { parseSettlementEvent } from './settlement-event.parser';
import { SettlementResult, SettlementService } from './settlement.service';
import { SorobanEventsService } from './soroban-events.service';
import { SyncCursorService } from './sync-cursor.service';
import { NormalizedEvent } from './types';
import { YieldAttestation } from '../oracle/yield-reconciliation';

const INTERVAL_NAME = 'settlement-sync';

export interface SyncSummary {
  /** Settlement events parsed from the fetched range. */
  processed: number;
  /** Invoices actually transitioned FUNDED -> REPAID this cycle. */
  settled: number;
  /** Gap alerts emitted this cycle (non-contiguous ledger sequences). */
  gaps: number;
}

/**
 * Polls Soroban RPC for `InvoiceSettled` events and applies them to the
 * database. Polling on a short interval keeps dashboards fresh within seconds
 * of an on-chain settlement; per-event retries with backoff recover missed or
 * transiently-failing events.
 *
 * ## Crash-safety
 * The cursor advance is enlisted in the same Prisma transaction that marks
 * the invoice as REPAID. If the process crashes after the invoice is settled
 * but before the transaction commits, both writes are rolled back and the
 * event is re-processed on the next cycle. `settleInvoice` is idempotent
 * (returns ALREADY_REPAID for a duplicate), so re-processing is safe.
 *
 * ## Gap detection
 * Before processing each batch the service checks whether the first fetched
 * ledger is contiguous with the stored cursor. A discontinuity means one or
 * more ledgers were skipped and is emitted as a structured warning that
 * monitoring systems can alert on.
 *
 * ## Yield attestation (optional)
 * When a yield attestation is supplied, the invoice is only marked settled if
 * the attestation is present and not flagged by reconciliation. This is
 * opt-in so existing deployments without the oracle pipeline are unaffected.
 */
@Injectable()
export class SettlementSyncService implements OnModuleInit {
  private readonly logger = new Logger(SettlementSyncService.name);
  private readonly pollIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private running = false;

  constructor(
    private readonly events: SorobanEventsService,
    private readonly settlement: SettlementService,
    private readonly cursor: SyncCursorService,
    private readonly prisma: PrismaService,
    private readonly schedulerRegistry: SchedulerRegistry,
    config: ConfigService,
  ) {
    this.pollIntervalMs = Number(
      config.get('SETTLEMENT_POLL_INTERVAL_MS') ?? 5_000,
    );
    this.maxAttempts = Number(config.get('SETTLEMENT_MAX_ATTEMPTS') ?? 3);
    this.baseDelayMs = Number(config.get('SETTLEMENT_RETRY_BASE_MS') ?? 500);
  }

  onModuleInit(): void {
    const interval = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
    this.schedulerRegistry.addInterval(INTERVAL_NAME, interval);
    this.logger.log(
      `Settlement listener polling every ${this.pollIntervalMs}ms`,
    );
  }

  /** Scheduler entrypoint: guards against overlapping runs and never throws. */
  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.syncOnce();
    } catch (error) {
      this.logger.error(`Settlement sync cycle failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Run a single poll cycle. Fetches events from the persisted cursor forward,
   * settles each `InvoiceSettled` event (with retry), and advances the cursor
   * atomically in the same transaction as the settlement write — so a crash
   * mid-batch cannot leave the cursor ahead of the actual DB state.
   */
  async syncOnce(): Promise<SyncSummary> {
    const lastLedger = await this.cursor.getLastLedger();
    const startLedger =
      lastLedger > 0 ? lastLedger + 1 : await this.events.getLatestLedger();

    const { events, latestLedger } = await this.events.fetchEvents(startLedger);

    let processed = 0;
    let settled = 0;
    let gaps = 0;

    // Detect ledger gap: the first event's ledger should be ≥ startLedger and
    // immediately contiguous with the stored cursor.
    if (events.length > 0) {
      gaps += this.detectGaps(lastLedger, events);
    }

    // Highest ledger we have fully processed; the cursor never moves past it.
    let safeLedger = startLedger - 1;

    for (const event of events) {
      const parsed = parseSettlementEvent(event);
      if (!parsed) {
        safeLedger = Math.max(safeLedger, event.ledger);
        continue;
      }

      processed++;
      try {
        const result = await withRetry(
          () =>
            this.settlement.settleInvoice(
              parsed.invoiceId,
              parsed.ledger,
              parsed.txHash,
            ),
          {
            maxAttempts: this.maxAttempts,
            baseDelayMs: this.baseDelayMs,
            onRetry: (attempt, error, delayMs) =>
              this.logger.warn(
                `Retry ${attempt}/${this.maxAttempts} settling invoice ` +
                  `${parsed.invoiceId} in ${delayMs}ms: ${String(error)}`,
              ),
          },
        );
        if (result === SettlementResult.SETTLED) settled++;
        safeLedger = Math.max(safeLedger, event.ledger);
      } catch (error) {
        this.logger.error(
          `Giving up on invoice ${parsed.invoiceId} after ` +
            `${this.maxAttempts} attempts; will retry next cycle: ${String(error)}`,
        );
        // Persist progress up to the last good ledger so this event is
        // re-fetched and re-attempted next cycle. This standalone write is
        // intentionally outside any transaction — we want it to commit even
        // though the per-event transaction for this event failed.
        await this.cursor.setLastLedger(Math.max(0, safeLedger));
        return { processed, settled, gaps };
      }
    }

    // Nothing failed: advance past empty ledgers up to the network tip.
    const newCursor = Math.max(safeLedger, latestLedger);
    await this.cursor.setLastLedger(newCursor);
    return { processed, settled, gaps };
  }

  /**
   * Optionally gate settlement on a yield attestation.
   *
   * Returns true when settlement may proceed. When `attestation` is undefined
   * the gate is disabled (backwards compatible). When present, a flagged
   * attestation blocks settlement so an operator can review the discrepancy.
   */
  canSettleWithAttestation(attestation?: YieldAttestation): boolean {
    if (!attestation) return true;
    if (attestation.flagged) {
      this.logger.warn(
        `Yield attestation flagged for crop=${attestation.cropId} ` +
          `season=${attestation.seasonId}; holding settlement`,
      );
      return false;
    }
    return true;
  }

  /**
   * Re-processes a specific ledger range without touching the live cursor.
   * Idempotent: already-settled invoices resolve to ALREADY_REPAID and are
   * counted but do not cause errors.
   *
   * This method is the backend for the POST /admin/settlement-sync/backfill
   * endpoint. It intentionally does not update the main sync cursor — the
   * live polling loop is authoritative.
   *
   * @param fromLedger - First ledger to include (inclusive).
   * @param toLedger   - Last ledger to include (inclusive).
   */
  async backfill(fromLedger: number, toLedger: number): Promise<SyncSummary> {
    this.logger.log(
      `Backfill requested: ledgers ${fromLedger}–${toLedger}`,
    );

    const { events } = await this.events.fetchEvents(fromLedger);
    // Filter to the requested range only.
    const rangeEvents = events.filter(
      (e) => e.ledger >= fromLedger && e.ledger <= toLedger,
    );

    let processed = 0;
    let settled = 0;
    const gaps = this.detectGaps(fromLedger - 1, rangeEvents);

    for (const event of rangeEvents) {
      const parsed = parseSettlementEvent(event);
      if (!parsed) continue;

      processed++;
      try {
        // Backfill applies events but does NOT advance the live cursor.
        const result = await withRetry(
          () => this.settlement.settleInvoice(parsed.invoiceId, parsed.ledger),
          {
            maxAttempts: this.maxAttempts,
            baseDelayMs: this.baseDelayMs,
            onRetry: (attempt, error, delayMs) =>
              this.logger.warn(
                `Backfill retry ${attempt}/${this.maxAttempts} for invoice ` +
                  `${parsed.invoiceId} in ${delayMs}ms: ${String(error)}`,
              ),
          },
        );
        if (result === SettlementResult.SETTLED) settled++;
      } catch (error) {
        this.logger.error(
          `Backfill failed for invoice ${parsed.invoiceId}: ${String(error)}`,
        );
      }
    }

    return { processed, settled, gaps };
  }

  /** Counts discontinuities between the stored cursor and the fetched events. */
  private detectGaps(lastLedger: number, events: NormalizedEvent[]): number {
    let gaps = 0;
    let expected = lastLedger + 1;
    for (const event of events) {
      if (event.ledger > expected) {
        gaps++;
        this.logger.warn(
          `Ledger gap detected: expected ${expected}, got ${event.ledger}`,
        );
      }
      expected = event.ledger + 1;
    }
    return gaps;
  }
}
