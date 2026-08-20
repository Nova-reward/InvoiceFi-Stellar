import { Injectable } from '@nestjs/common';
import { YieldAttestation } from './yield-attestation.types';

/**
 * Queue of reconciled yield attestations, written by
 * {@link YieldReconciliationService} and read by {@link YieldGateService}
 * before it allows a crop-yield-gated invoice to settle.
 *
 * Modeled as "queue" per the issue's framing, but the actual access
 * pattern is "latest attestation per crop/season" rather than FIFO
 * consumption — settlement-sync needs to repeatedly check "is there
 * (still) a usable attestation for this crop/season," not drain one
 * attestation per check. `peek` never removes an entry: a later poll cycle
 * (or a different invoice on the same crop/season) may need the same
 * attestation again.
 */
export interface YieldAttestationQueue {
  /** Record the latest attestation for its crop/season, superseding any prior one. */
  enqueue(attestation: YieldAttestation): Promise<void>;
  /** The latest attestation for `cropId`/`seasonId`, if reconciliation has ever produced one. */
  peek(
    cropId: string,
    seasonId: string,
  ): Promise<YieldAttestation | undefined>;
}

export const YIELD_ATTESTATION_QUEUE = Symbol('YIELD_ATTESTATION_QUEUE');

/**
 * In-memory stub implementation. Sufficient for a single-process
 * deployment and for tests; a production deployment would back this with
 * the same durable-row pattern `WebhookDispatchService`/`WebhookDelivery`
 * already use elsewhere in this codebase (see the architecture doc's "Data
 * retention" section) — swapping in a Prisma-backed implementation behind
 * this same interface is the natural next step, and explicitly out of
 * scope for this issue.
 */
@Injectable()
export class InMemoryYieldAttestationQueue implements YieldAttestationQueue {
  private readonly attestations = new Map<string, YieldAttestation>();

  async enqueue(attestation: YieldAttestation): Promise<void> {
    this.attestations.set(key(attestation.cropId, attestation.seasonId), attestation);
  }

  async peek(
    cropId: string,
    seasonId: string,
  ): Promise<YieldAttestation | undefined> {
    return this.attestations.get(key(cropId, seasonId));
  }
}

function key(cropId: string, seasonId: string): string {
  return `${cropId}:${seasonId}`;
}
