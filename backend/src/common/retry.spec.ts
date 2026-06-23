import { withRetry } from './retry';

describe('withRetry', () => {
  it('returns the result without retrying on success', async () => {
    const fn = jest.fn(async () => 42);
    await expect(withRetry(fn)).resolves.toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries until success and reports exponential backoff delays', async () => {
    const delays: number[] = [];
    let attempts = 0;
    const fn = jest.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('transient');
      return 'ok';
    });

    const result = await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 10,
      onRetry: (_attempt, _error, delayMs) => delays.push(delayMs),
    });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    // base * 2^0, base * 2^1
    expect(delays).toEqual([10, 20]);
  });

  it('throws the last error after exhausting maxAttempts', async () => {
    const fn = jest.fn(async () => {
      throw new Error('boom');
    });

    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 }),
    ).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('caps the backoff delay at maxDelayMs', async () => {
    const delays: number[] = [];
    const fn = jest.fn(async () => {
      throw new Error('x');
    });

    await expect(
      withRetry(fn, {
        maxAttempts: 4,
        baseDelayMs: 100,
        maxDelayMs: 150,
        onRetry: (_a, _e, d) => delays.push(d),
      }),
    ).rejects.toThrow('x');

    // 100, min(200,150)=150, min(400,150)=150
    expect(delays).toEqual([100, 150, 150]);
  });
});
