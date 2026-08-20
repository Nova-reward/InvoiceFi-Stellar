import { MAX_DELIVERY_ATTEMPTS, nextRetryDelayMs, RETRY_SCHEDULE_MS } from './retry-schedule';

describe('retry-schedule', () => {
  it('matches the schedule from the issue: 1m, 5m, 30m, 2h, 12h, 24h', () => {
    expect(RETRY_SCHEDULE_MS).toEqual([
      60_000,
      5 * 60_000,
      30 * 60_000,
      2 * 60 * 60_000,
      12 * 60 * 60_000,
      24 * 60 * 60_000,
    ]);
  });

  it('returns the delay before the next attempt for each attempt in the schedule', () => {
    expect(nextRetryDelayMs(1)).toBe(60_000);
    expect(nextRetryDelayMs(2)).toBe(5 * 60_000);
    expect(nextRetryDelayMs(3)).toBe(30 * 60_000);
    expect(nextRetryDelayMs(4)).toBe(2 * 60 * 60_000);
    expect(nextRetryDelayMs(5)).toBe(12 * 60 * 60_000);
    expect(nextRetryDelayMs(6)).toBe(24 * 60 * 60_000);
  });

  it('returns null once the schedule is exhausted (abandon after the 7th attempt)', () => {
    expect(MAX_DELIVERY_ATTEMPTS).toBe(7);
    expect(nextRetryDelayMs(7)).toBeNull();
    expect(nextRetryDelayMs(8)).toBeNull();
  });

  it('rejects a non-positive or non-integer attempt number', () => {
    expect(() => nextRetryDelayMs(0)).toThrow();
    expect(() => nextRetryDelayMs(-1)).toThrow();
    expect(() => nextRetryDelayMs(1.5)).toThrow();
  });
});
