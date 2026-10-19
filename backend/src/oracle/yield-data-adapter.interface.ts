/**
 * Crop-yield data ingestion pipeline — adapter interface.
 *
 * See `docs/yield-ingestion-pipeline.md` for the architecture, reconciliation
 * rules, failure modes, and data retention policy.
 */

export interface YieldReading {
  /** Crop identifier (matches the on-chain crop registry id). */
  cropId: string;
  /** Season identifier (e.g. "2024-Q3"). */
  seasonId: string;
  /** Yield in tonnes per hectare. */
  yieldTonnesPerHectare: number;
  /** Source that produced this reading (adapter name). */
  source: string;
  /** ISO-8601 timestamp of when the reading was observed. */
  observedAt: string;
  /** Optional confidence in [0, 1]; adapters may omit it. */
  confidence?: number;
}

/**
 * A data-source adapter that can fetch a yield reading for a crop/season.
 *
 * Implementations must be side-effect free with respect to the settlement
 * pipeline: they only fetch and normalise data. Reconciliation and queueing
 * are handled by the ingestion service.
 */
export interface YieldDataAdapter {
  /** Stable adapter name used in logs and reconciliation output. */
  readonly name: string;

  /**
   * Fetch a yield reading for the given crop and season.
   *
   * @throws when the source is unavailable or returns no usable data.
   */
  fetchYield(cropId: string, seasonId: string): Promise<YieldReading>;
}
