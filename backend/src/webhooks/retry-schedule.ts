/**
 * Fixed backoff schedule for webhook delivery retries, per issue #60's
 * acceptance criteria: 1m, 5m, 30m, 2h, 12h, 24h, then abandon.
 *
 * Index 0 is the delay before the 2nd attempt (i.e. after the 1st attempt
 * fails), index 1 before the 3rd, and so on. This is a fixed schedule rather
 * than the codebase's generic `withRetry` exponential backoff (see
 * `common/retry.ts`) because deliveries are retried across process restarts
 * over hours/days, not within a single in-memory call.
 */
export const RETRY_SCHEDULE_MS: readonly number[] = [
  60_000, // 1m
  5 * 60_000, // 5m
  30 * 60_000, // 30m
  2 * 60 * 60_000, // 2h
  12 * 60 * 60_000, // 12h
  24 * 60 * 60_000, // 24h
];

/** Total attempts made before a delivery is abandoned (1 initial + retries). */
export const MAX_DELIVERY_ATTEMPTS = RETRY_SCHEDULE_MS.length + 1;

/**
 * Delay (ms) before the next attempt, given that `attemptNumber` (1-indexed:
 * the attempt that just failed) has failed. Returns `null` once the schedule
 * is exhausted and the delivery should be abandoned instead of retried.
 */
export function nextRetryDelayMs(attemptNumber: number): number | null {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
    throw new Error(`attemptNumber must be a positive integer, got ${attemptNumber}`);
  }
  const index = attemptNumber - 1;
  return index < RETRY_SCHEDULE_MS.length ? RETRY_SCHEDULE_MS[index] : null;
}
