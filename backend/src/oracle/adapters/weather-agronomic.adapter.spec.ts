import { YieldDataNotFoundError } from '../yield-data-adapter.interface';
import { WeatherAgronomicAdapter } from './weather-agronomic.adapter';

describe('WeatherAgronomicAdapter', () => {
  const adapter = new WeatherAgronomicAdapter();

  it('exposes a stable sourceId', () => {
    expect(adapter.sourceId).toBe('weather-agronomic-model');
  });

  it('returns a normalized reading for a fixture crop/season', async () => {
    const reading = await adapter.fetchYield('maize-yellow-dent', '2026-kharif');

    expect(reading).toMatchObject({
      cropId: 'maize-yellow-dent',
      seasonId: '2026-kharif',
      sourceId: 'weather-agronomic-model',
      yieldKgPerHectare: 5820,
    });
    expect(reading.observedAt).toBeInstanceOf(Date);
    expect(reading.confidence).toBeGreaterThan(0);
    expect(reading.confidence).toBeLessThanOrEqual(1);
  });

  it('rejects with YieldDataNotFoundError for an unknown crop/season', async () => {
    await expect(
      adapter.fetchYield('unobtainium', '2099-offseason'),
    ).rejects.toBeInstanceOf(YieldDataNotFoundError);
  });

  it('does not confuse readings for different seasons of the same crop', async () => {
    await expect(
      adapter.fetchYield('maize-yellow-dent', '2025-kharif'),
    ).rejects.toBeInstanceOf(YieldDataNotFoundError);
  });
});
