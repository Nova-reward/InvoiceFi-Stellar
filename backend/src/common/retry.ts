export interface RetryOptions {
  /** Maximum number of attempts (including the first). */
  maxAttempts?: number;
  /** Base delay in milliseconds for the exponential backoff. */
  baseDelayMs?: number;
  /** Upper bound on a single backoff delay. */
  maxDelayMs?: number;
  /** Invoked before each retry with the failed attempt number and the error. */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

const DEFAULTS: Required<Omit<RetryOptions, 'onRetry'>> = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying on rejection with exponential backoff.
 *
 * Delay before retry N (1-indexed) is `baseDelayMs * 2^(N-1)`, capped at
 * `maxDelayMs`. After `maxAttempts` failures the last error is rethrown.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs } = { ...DEFAULTS, ...options };

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;

      const delayMs = Math.min(
        baseDelayMs * 2 ** (attempt - 1),
        maxDelayMs,
      );
      options.onRetry?.(attempt, error, delayMs);
      await sleep(delayMs);
    }
  }
  throw lastError;
}
