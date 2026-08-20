import { YieldReading } from './yield-data-adapter.interface';

/** Outcome of reconciling every source's reading for one crop/season. */
export enum YieldAttestationStatus {
  /**
   * Either a single source responded (nothing to reconcile against), or
   * multiple sources responded and agreed within {@link ReconciliationPolicy.toleranceRatio}.
   * `finalYieldKgPerHectare` is set and usable for settlement.
   */
  RECONCILED = 'reconciled',
  /**
   * Two or more sources responded but disagreed beyond tolerance.
   * `finalYieldKgPerHectare` is unset — this attestation is *not* usable
   * for settlement until a human resolves the conflict (see the
   * "Disputed readings" failure mode in the architecture doc).
   */
  DISPUTED = 'disputed',
  /** No configured source returned a reading for this crop/season. */
  INSUFFICIENT_DATA = 'insufficient_data',
}

/**
 * The output of one reconciliation run: what
 * {@link YieldReconciliationService} writes to the
 * {@link YieldAttestationQueue}, and what {@link YieldGateService} reads
 * back before allowing a crop-yield-gated invoice to settle.
 */
export interface YieldAttestation {
  cropId: string;
  seasonId: string;
  status: YieldAttestationStatus;
  /** Only present when `status === RECONCILED`. */
  finalYieldKgPerHectare?: number;
  /** Every reading that went into this decision, for audit — including from sources that disagreed. */
  readings: YieldReading[];
  /** When reconciliation produced this attestation. */
  reconciledAt: Date;
  /** Human-readable explanation of the status (which tolerance was applied, which sources disagreed and by how much, etc). */
  notes: string;
}

/** Configurable reconciliation rule set (see {@link YieldReconciliationService}). */
export interface ReconciliationPolicy {
  /**
   * Maximum relative difference between the lowest and highest reading,
   * computed against their mean — `(max - min) / mean` — still considered
   * agreement. `0.05` means readings within 5% of each other reconcile
   * automatically; wider spreads are marked `DISPUTED`.
   */
  toleranceRatio: number;
}

export const DEFAULT_RECONCILIATION_POLICY: ReconciliationPolicy = {
  toleranceRatio: 0.05,
};
