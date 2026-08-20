import { YieldDataNotFoundError } from '../yield-data-adapter.interface';
import { GovernmentCropReportingAdapter } from './government-crop-reporting.adapter';

describe('GovernmentCropReportingAdapter', () => {
  const adapter = new GovernmentCropReportingAdapter();

  it('exposes a stable sourceId', () => {
    expect(adapter.sourceId).toBe('gov-crop-reporting-feed');
  });

  it('returns a normalized reading for a fixture crop/season', async () => {
    const reading = await adapter.fetchYield('maize-yellow-dent', '2026-kharif');

    expect(reading).toMatchObject({
      cropId: 'maize-yellow-dent',
      seasonId: '2026-kharif',
      sourceId: 'gov-crop-reporting-feed',
      yieldKgPerHectare: 5900,
    });
    expect(reading.observedAt).toBeInstanceOf(Date);
  });

  it('never reports a confidence score (official figures, not a model)', async () => {
    const reading = await adapter.fetchYield('wheat-hard-red', '2026-rabi');
    expect(reading.confidence).toBeUndefined();
  });

  it('rejects with YieldDataNotFoundError for an unknown crop/season', async () => {
    await expect(
      adapter.fetchYield('unobtainium', '2099-offseason'),
    ).rejects.toBeInstanceOf(YieldDataNotFoundError);
  });
});
