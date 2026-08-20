/**
 * A single yield observation from one upstream data source, already
 * normalized to this pipeline's common unit (kg/hectare) and shape. Each
 * {@link YieldDataAdapter} implementation is responsible for translating
 * its source's native format into this before returning it — the
 * reconciliation service never has to know the source-specific shape.
 */
export interface YieldReading {
  /** Which crop this reading is for (e.g. a variety or commodity code). */
  cropId: string;
  /** Which growing season this reading is for (e.g. `"2026-kharif"`). */
  seasonId: string;
  /** Reported yield, normalized to kilograms per hectare. */
  yieldKgPerHectare: number;
  /** When the *underlying source* recorded/observed this reading (not when we fetched it). */
  observedAt: Date;
  /** Stable identifier for the adapter that produced this reading; carried into the attestation for audit. */
  sourceId: string;
  /**
   * Source-reported confidence in `[0, 1]`, if the source provides one
   * (e.g. a weather-model reading derived from a sparse station network
   * might self-report lower confidence than a dense one). Adapters that
   * have no such signal should omit it rather than invent a value.
   */
  confidence?: number;
}

/**
 * Raised by an adapter when it has no reading for the requested
 * `cropId`/`seasonId` at all (as opposed to a transient fetch failure,
 * which should just reject the promise with whatever error the transport
 * produced). Reconciliation treats this distinctly from a transport error:
 * both are absorbed into "this source didn't contribute a reading," but a
 * transport error is worth logging louder, since it may indicate the
 * source is unreachable rather than genuinely lacking data.
 */
export class YieldDataNotFoundError extends Error {
  constructor(sourceId: string, cropId: string, seasonId: string) {
    super(
      `No yield reading available from ${sourceId} for crop ${cropId}, season ${seasonId}`,
    );
    this.name = 'YieldDataNotFoundError';
  }
}

/**
 * A single upstream yield data source. The protocol combines at least two
 * independent adapters (see `docs/architecture/crop-yield-oracle-pipeline.md`)
 * so that no single source can unilaterally determine a settlement-affecting
 * yield figure — {@link YieldReconciliationService} is the piece that
 * combines their readings into one {@link YieldAttestation}.
 */
export interface YieldDataAdapter {
  /** Stable identifier for this source, carried into every reading it produces. */
  readonly sourceId: string;

  /**
   * Fetch this source's yield reading for a crop/season. Rejects (does not
   * return a sentinel) on any failure — including "no data for this
   * crop/season" (see {@link YieldDataNotFoundError}) and transient
   * transport failures — so callers can distinguish "got a reading" from
   * every flavor of "didn't," using `Promise.allSettled`, without a adapter
   * having to encode failure into the reading shape itself.
   */
  fetchYield(cropId: string, seasonId: string): Promise<YieldReading>;
}
