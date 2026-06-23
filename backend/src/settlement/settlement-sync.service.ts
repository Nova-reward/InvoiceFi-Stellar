import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { withRetry } from '../common/retry';
import { parseSettlementEvent } from './settlement-event.parser';
import { SettlementResult, SettlementService } from './settlement.service';
import { SorobanEventsService } from './soroban-events.service';
import { SyncCursorService } from './sync-cursor.service';

const INTERVAL_NAME = 'settlement-sync';

export interface SyncSummary {
  /** Settlement events parsed from the fetched range. */
  processed: number;
  /** Invoices actually transitioned FUNDED -> REPAID this cycle. */
  settled: number;
}

/**
 * Polls Soroban RPC for `InvoiceSettled` events and applies them to the
 * database. Polling on a short interval keeps dashboards fresh within seconds
 * of an on-chain settlement; per-event retries with backoff recover missed or
 * transiently-failing events.
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
   * only over ledgers that were fully processed — so a permanently-failing
   * event is re-attempted on the next cycle rather than silently skipped.
   */
  async syncOnce(): Promise<SyncSummary> {
    const lastLedger = await this.cursor.getLastLedger();
    const startLedger =
      lastLedger > 0 ? lastLedger + 1 : await this.events.getLatestLedger();

    const { events, latestLedger } = await this.events.fetchEvents(startLedger);

    let processed = 0;
    let settled = 0;
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
          () => this.settlement.settleInvoice(parsed.invoiceId, parsed.ledger),
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
        // Stop here: persist progress up to the last good ledger so this event
        // is re-fetched and re-attempted next cycle.
        await this.cursor.setLastLedger(Math.max(0, safeLedger));
        return { processed, settled };
      }
    }

    // Nothing failed: skip ahead past empty ledgers up to the network tip.
    const newCursor = Math.max(safeLedger, latestLedger);
    await this.cursor.setLastLedger(newCursor);
    return { processed, settled };
  }
}
