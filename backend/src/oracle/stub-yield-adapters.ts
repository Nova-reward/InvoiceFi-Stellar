/**
 * Crop-yield data ingestion pipeline — adapter interface and stub implementations.
 *
 * See docs/yield-ingestion-architecture.md for the reconciliation logic,
 * failure modes, and data retention policy.
 */

export interface YieldReading {
  /** Crop identifier (e.g. "maize"). */
  cropId: string;
  /** Season identifier (e.g. "2024-KE-01"). */
  seasonId: string;
  /** Yield in tonnes per hectare. */
  yieldTonnesPerHectare: number;
  /** Source that produced the reading. */
  source: string;
  /** ISO-8601 timestamp of when the reading was observed. */
  observedAt: string;
  /** Optional confidence in [0, 1]; adapters may omit it. */
  confidence?: number;
}

export interface YieldDataAdapter {
  /** Human-readable source name, used in reconciliation and attestations. */
  readonly source: string;
  /**
   * Fetch a yield reading for the given crop and season.
   * Rejects when the source has no reading for the pair.
   */
  fetchYield(cropId: string, seasonId: string): Promise<YieldReading>;
}

/**
 * In-memory fixture adapter. Subclasses (or callers) supply the fixture map;
 * lookups are keyed by `${cropId}:${seasonId}`.
 */
export class InMemoryYieldAdapter implements YieldDataAdapter {
  readonly source: string;
  private readonly fixtures: Map<string, YieldReading>;

  constructor(source: string, fixtures: YieldReading[]) {
    this.source = source;
    this.fixtures = new Map(
      fixtures.map((reading) => [
        `${reading.cropId}:${reading.seasonId}`,
        { ...reading, source },
      ]),
    );
  }

  async fetchYield(cropId: string, seasonId: string): Promise<YieldReading> {
    const reading = this.fixtures.get(`${cropId}:${seasonId}`);
    if (!reading) {
      throw new Error(
        `No yield reading for crop=${cropId} season=${seasonId} in source=${this.source}`,
      );
    }
    return { ...reading };
  }
}

/** Stub adapter backed by an agronomic / weather API fixture. */
export class AgronomicApiYieldAdapter extends InMemoryYieldAdapter {
  constructor(fixtures: YieldReading[] = DEFAULT_AGRONOMIC_FIXTURES) {
    super('agronomic-api', fixtures);
  }
}

/** Stub adapter backed by a government crop reporting feed fixture. */
export class GovernmentFeedYieldAdapter extends InMemoryYieldAdapter {
  constructor(fixtures: YieldReading[] = DEFAULT_GOVERNMENT_FIXTURES) {
    super('government-feed', fixtures);
  }
}

export const DEFAULT_AGRONOMIC_FIXTURES: YieldReading[] = [
  {
    cropId: 'maize',
    seasonId: '2024-KE-01',
    yieldTonnesPerHectare: 3.2,
    source: 'agronomic-api',
    observedAt: '2024-09-01T00:00:00.000Z',
    confidence: 0.8,
  },
  {
    cropId: 'wheat',
    seasonId: '2024-KE-01',
    yieldTonnesPerHectare: 2.1,
    source: 'agronomic-api',
    observedAt: '2024-09-01T00:00:00.000Z',
    confidence: 0.75,
  },
];

export const DEFAULT_GOVERNMENT_FIXTURES: YieldReading[] = [
  {
    cropId: 'maize',
    seasonId: '2024-KE-01',
    yieldTonnesPerHectare: 3.0,
    source: 'government-feed',
    observedAt: '2024-09-05T00:00:00.000Z',
    confidence: 0.9,
  },
  {
    cropId: 'wheat',
    seasonId: '2024-KE-01',
    yieldTonnesPerHectare: 2.4,
    source: 'government-feed',
    observedAt: '2024-09-05T00:00:00.000Z',
    confidence: 0.85,
  },
];
