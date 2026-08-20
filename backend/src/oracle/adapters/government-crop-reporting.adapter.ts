import { Injectable } from '@nestjs/common';
import {
  YieldDataAdapter,
  YieldDataNotFoundError,
  YieldReading,
} from '../yield-data-adapter.interface';

/** In-memory fixture standing in for a real government crop reporting feed. */
interface GovernmentReportFixture {
  reportedYieldKgPerHectare: number;
  reportPublishedAt: Date;
}

/**
 * Stub adapter for an official government crop reporting feed (e.g. a
 * national agriculture ministry's district-level yield survey). Ships with
 * a small in-memory fixture set rather than a real HTTP/SFTP/file-drop
 * client — wiring a production endpoint is explicitly out of scope for
 * this issue (see `docs/architecture/crop-yield-oracle-pipeline.md`); this
 * class is the seam a real implementation drops into, with an identical
 * `fetchYield` contract.
 *
 * Government reports have no self-reported confidence signal — they're
 * official published figures, not a probabilistic model — so readings
 * from this adapter always omit `confidence`.
 */
@Injectable()
export class GovernmentCropReportingAdapter implements YieldDataAdapter {
  readonly sourceId = 'gov-crop-reporting-feed';

  private readonly fixtures = new Map<string, GovernmentReportFixture>([
    [
      key('maize-yellow-dent', '2026-kharif'),
      {
        reportedYieldKgPerHectare: 5900,
        reportPublishedAt: new Date('2026-12-15T00:00:00Z'),
      },
    ],
    [
      key('wheat-hard-red', '2026-rabi'),
      {
        reportedYieldKgPerHectare: 3080,
        reportPublishedAt: new Date('2027-05-20T00:00:00Z'),
      },
    ],
    [
      // See the comment on the matching soybean fixture in
      // WeatherAgronomicAdapter — deliberately disagrees beyond tolerance.
      key('soybean-food-grade', '2026-kharif'),
      {
        reportedYieldKgPerHectare: 3540,
        reportPublishedAt: new Date('2026-12-20T00:00:00Z'),
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
      yieldKgPerHectare: fixture.reportedYieldKgPerHectare,
      observedAt: fixture.reportPublishedAt,
      sourceId: this.sourceId,
    };
  }
}

function key(cropId: string, seasonId: string): string {
  return `${cropId}:${seasonId}`;
}
