import { Inject, Injectable, Logger } from '@nestjs/common';
import { YieldDataAdapter, YieldReading } from './yield-data-adapter.interface';
import {
  DEFAULT_RECONCILIATION_POLICY,
  ReconciliationPolicy,
  YieldAttestation,
  YieldAttestationStatus,
} from './yield-attestation.types';
import {
  YIELD_ATTESTATION_QUEUE,
  YieldAttestationQueue,
} from './yield-attestation-queue';

export const YIELD_DATA_ADAPTERS = Symbol('YIELD_DATA_ADAPTERS');
export const RECONCILIATION_POLICY = Symbol('RECONCILIATION_POLICY');

/**
 * Fetches a yield reading from every configured {@link YieldDataAdapter}
 * for one crop/season, reconciles them into a single
 * {@link YieldAttestation}, and writes it to the
 * {@link YieldAttestationQueue}. See
 * `docs/architecture/crop-yield-oracle-pipeline.md` for the full
 * reconciliation-logic and failure-mode write-up; this is the reference
 * implementation of the policy described there.
 */
@Injectable()
export class YieldReconciliationService {
  private readonly logger = new Logger(YieldReconciliationService.name);

  constructor(
    @Inject(YIELD_DATA_ADAPTERS)
    private readonly adapters: YieldDataAdapter[],
    @Inject(YIELD_ATTESTATION_QUEUE)
    private readonly queue: YieldAttestationQueue,
    @Inject(RECONCILIATION_POLICY)
    private readonly policy: ReconciliationPolicy = DEFAULT_RECONCILIATION_POLICY,
  ) {}

  /**
   * Query every adapter concurrently, reconcile whichever readings come
   * back, enqueue the result, and return it. Never rejects on an
   * individual adapter's failure — a source being down degrades the
   * attestation (fewer readings to reconcile, or `INSUFFICIENT_DATA` if
   * every source failed) rather than blocking the whole pipeline; each
   * failure is logged so an operator can tell "no data exists yet" apart
   * from "a source is unreachable."
   */
  async reconcile(cropId: string, seasonId: string): Promise<YieldAttestation> {
    const settled = await Promise.allSettled(
      this.adapters.map((adapter) => adapter.fetchYield(cropId, seasonId)),
    );

    const readings: YieldReading[] = [];
    settled.forEach((outcome, i) => {
      if (outcome.status === 'fulfilled') {
        readings.push(outcome.value);
      } else {
        this.logger.warn(
          `${this.adapters[i].sourceId} failed to produce a reading for ` +
            `${cropId}/${seasonId}: ${String(outcome.reason)}`,
        );
      }
    });

    const attestation = this.buildAttestation(cropId, seasonId, readings);
    await this.queue.enqueue(attestation);
    return attestation;
  }

  private buildAttestation(
    cropId: string,
    seasonId: string,
    readings: YieldReading[],
  ): YieldAttestation {
    const reconciledAt = new Date();

    if (readings.length === 0) {
      return {
        cropId,
        seasonId,
        status: YieldAttestationStatus.INSUFFICIENT_DATA,
        readings,
        reconciledAt,
        notes: `No source returned a reading (${this.adapters.length} configured).`,
      };
    }

    if (readings.length === 1) {
      return {
        cropId,
        seasonId,
        status: YieldAttestationStatus.RECONCILED,
        finalYieldKgPerHectare: readings[0].yieldKgPerHectare,
        readings,
        reconciledAt,
        notes: `Only ${readings[0].sourceId} returned a reading; used it as-is (nothing to reconcile against).`,
      };
    }

    const values = readings.map((r) => r.yieldKgPerHectare);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const relativeSpread = mean === 0 ? 0 : (max - min) / mean;

    if (relativeSpread <= this.policy.toleranceRatio) {
      return {
        cropId,
        seasonId,
        status: YieldAttestationStatus.RECONCILED,
        finalYieldKgPerHectare: mean,
        readings,
        reconciledAt,
        notes:
          `${readings.length} sources agreed within ` +
          `${(this.policy.toleranceRatio * 100).toFixed(1)}% tolerance ` +
          `(spread ${(relativeSpread * 100).toFixed(2)}%); averaged.`,
      };
    }

    return {
      cropId,
      seasonId,
      status: YieldAttestationStatus.DISPUTED,
      readings,
      reconciledAt,
      notes:
        `${readings.length} sources disagreed beyond ` +
        `${(this.policy.toleranceRatio * 100).toFixed(1)}% tolerance ` +
        `(spread ${(relativeSpread * 100).toFixed(2)}%: ` +
        readings.map((r) => `${r.sourceId}=${r.yieldKgPerHectare}`).join(', ') +
        '); requires manual review before this crop/season can settle.',
    };
  }
}
