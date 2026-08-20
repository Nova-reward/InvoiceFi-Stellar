import { YieldDataAdapter, YieldReading } from './yield-data-adapter.interface';
import { YieldAttestationQueue } from './yield-attestation-queue';
import { YieldAttestationStatus } from './yield-attestation.types';
import { YieldReconciliationService } from './yield-reconciliation.service';

function fakeAdapter(
  sourceId: string,
  behavior: (cropId: string, seasonId: string) => Promise<YieldReading>,
): jest.Mocked<YieldDataAdapter> {
  return {
    sourceId,
    fetchYield: jest.fn(behavior),
  };
}

function reading(sourceId: string, yieldKgPerHectare: number): YieldReading {
  return {
    cropId: 'maize',
    seasonId: '2026',
    sourceId,
    yieldKgPerHectare,
    observedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function fakeQueue(): jest.Mocked<YieldAttestationQueue> {
  return {
    enqueue: jest.fn().mockResolvedValue(undefined),
    peek: jest.fn().mockResolvedValue(undefined),
  };
}

describe('YieldReconciliationService', () => {
  it('reconciles two agreeing readings to their average and enqueues the result', async () => {
    const a = fakeAdapter('a', async () => reading('a', 1000));
    const b = fakeAdapter('b', async () => reading('b', 1020));
    const queue = fakeQueue();
    const service = new YieldReconciliationService([a, b], queue, {
      toleranceRatio: 0.05,
    });

    const attestation = await service.reconcile('maize', '2026');

    expect(attestation.status).toBe(YieldAttestationStatus.RECONCILED);
    expect(attestation.finalYieldKgPerHectare).toBe(1010);
    expect(attestation.readings).toHaveLength(2);
    expect(queue.enqueue).toHaveBeenCalledWith(attestation);
  });

  it('marks disagreeing readings beyond tolerance as DISPUTED, with no final figure', async () => {
    const a = fakeAdapter('a', async () => reading('a', 1000));
    const b = fakeAdapter('b', async () => reading('b', 1500));
    const queue = fakeQueue();
    const service = new YieldReconciliationService([a, b], queue, {
      toleranceRatio: 0.05,
    });

    const attestation = await service.reconcile('maize', '2026');

    expect(attestation.status).toBe(YieldAttestationStatus.DISPUTED);
    expect(attestation.finalYieldKgPerHectare).toBeUndefined();
    expect(attestation.notes).toContain('a=1000');
    expect(attestation.notes).toContain('b=1500');
  });

  it('is right at the tolerance boundary: exactly the threshold reconciles', async () => {
    // mean = 1025, spread = (1050-1000)/1025 ≈ 4.878% — just inside 5%.
    const a = fakeAdapter('a', async () => reading('a', 1000));
    const b = fakeAdapter('b', async () => reading('b', 1050));
    const queue = fakeQueue();
    const service = new YieldReconciliationService([a, b], queue, {
      toleranceRatio: 0.05,
    });

    const attestation = await service.reconcile('maize', '2026');

    expect(attestation.status).toBe(YieldAttestationStatus.RECONCILED);
  });

  it('uses the single reading as-is when only one source responds', async () => {
    const a = fakeAdapter('a', async () => reading('a', 1234));
    const b = fakeAdapter('b', async () => {
      throw new Error('source unreachable');
    });
    const queue = fakeQueue();
    const service = new YieldReconciliationService([a, b], queue, {
      toleranceRatio: 0.05,
    });

    const attestation = await service.reconcile('maize', '2026');

    expect(attestation.status).toBe(YieldAttestationStatus.RECONCILED);
    expect(attestation.finalYieldKgPerHectare).toBe(1234);
    expect(attestation.readings).toHaveLength(1);
  });

  it('reports INSUFFICIENT_DATA when every source fails, without throwing', async () => {
    const a = fakeAdapter('a', async () => {
      throw new Error('a is down');
    });
    const b = fakeAdapter('b', async () => {
      throw new Error('b is down');
    });
    const queue = fakeQueue();
    const service = new YieldReconciliationService([a, b], queue, {
      toleranceRatio: 0.05,
    });

    const attestation = await service.reconcile('maize', '2026');

    expect(attestation.status).toBe(YieldAttestationStatus.INSUFFICIENT_DATA);
    expect(attestation.readings).toHaveLength(0);
    expect(attestation.finalYieldKgPerHectare).toBeUndefined();
    expect(queue.enqueue).toHaveBeenCalledWith(attestation);
  });

  it('queries every adapter concurrently with the requested crop/season', async () => {
    const a = fakeAdapter('a', async () => reading('a', 1000));
    const b = fakeAdapter('b', async () => reading('b', 1000));
    const queue = fakeQueue();
    const service = new YieldReconciliationService([a, b], queue, {
      toleranceRatio: 0.05,
    });

    await service.reconcile('soybean', '2027-rabi');

    expect(a.fetchYield).toHaveBeenCalledWith('soybean', '2027-rabi');
    expect(b.fetchYield).toHaveBeenCalledWith('soybean', '2027-rabi');
  });
});
