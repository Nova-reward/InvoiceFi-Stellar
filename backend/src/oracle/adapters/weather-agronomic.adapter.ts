import { Injectable } from '@nestjs/common';
import {
  YieldDataAdapter,
  YieldDataNotFoundError,
  YieldReading,
} from '../yield-data-adapter.interface';

/** In-memory fixture standing in for a real weather/agronomic model API. */
interface WeatherModelFixture {
  estimatedYieldKgPerHectare: number;
  modelRunAt: Date;
  /** This source's own self-reported confidence, e.g. based on station density. */
  confidence: number;
}

/**
 * Stub adapter for a weather-and-agronomic-model yield estimate (e.g. a
 * NDVI/satellite-derived or station-network-driven model). Ships with a
 * small in-memory fixture set rather than a real HTTP client — wiring a
 * production API key/endpoint is explicitly out of scope for this issue
 * (see `docs/architecture/crop-yield-oracle-pipeline.md`); this class is
 * the seam a real implementation drops into, with an identical
 * `fetchYield` contract.
 */
@Injectable()
export class WeatherAgronomicAdapter implements YieldDataAdapter {
  readonly sourceId = 'weather-agronomic-model';

  private readonly fixtures = new Map<string, WeatherModelFixture>([
    [
      key('maize-yellow-dent', '2026-kharif'),
      {
        estimatedYieldKgPerHectare: 5820,
        modelRunAt: new Date('2026-11-02T06:00:00Z'),
        confidence: 0.82,
      },
    ],
    [
      key('wheat-hard-red', '2026-rabi'),
      {
        estimatedYieldKgPerHectare: 3140,
        modelRunAt: new Date('2027-04-10T06:00:00Z'),
        confidence: 0.88,
      },
    ],
    [
      // Deliberately far from the government fixture for the same
      // crop/season, so tests (and the reconciliation service) have a
      // realistic "sources disagree" case to exercise.
      key('soybean-food-grade', '2026-kharif'),
      {
        estimatedYieldKgPerHectare: 2960,
        modelRunAt: new Date('2026-11-05T06:00:00Z'),
        confidence: 0.61,
      },
    ],
  ]);

  async fetchYield(cropId: string, seasonId: string): Promise<YieldReading> {
    const fixture = this.fixtures.get(key(cropId, seasonId));
    if (!fixture) {
      throw new YieldDataNotFoundError(this.sourceId, cropId, seasonId);
    }
    return {
      cropId,
      seasonId,
      yieldKgPerHectare: fixture.estimatedYieldKgPerHectare,
      observedAt: fixture.modelRunAt,
      sourceId: this.sourceId,
      confidence: fixture.confidence,
    };
  }
}

function key(cropId: string, seasonId: string): string {
  return `${cropId}:${seasonId}`;
}
