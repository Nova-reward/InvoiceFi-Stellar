import { InMemoryYieldAttestationQueue } from './yield-attestation-queue';
import { YieldAttestationStatus } from './yield-attestation.types';

function attestation(cropId: string, seasonId: string, finalYield: number) {
  return {
    cropId,
    seasonId,
    status: YieldAttestationStatus.RECONCILED,
    finalYieldKgPerHectare: finalYield,
    readings: [],
    reconciledAt: new Date('2026-01-01T00:00:00Z'),
    notes: 'test fixture',
  };
}

describe('InMemoryYieldAttestationQueue', () => {
  it('returns undefined for a crop/season that was never enqueued', async () => {
    const queue = new InMemoryYieldAttestationQueue();
    expect(await queue.peek('maize', '2026')).toBeUndefined();
  });

  it('returns the enqueued attestation for its exact crop/season', async () => {
    const queue = new InMemoryYieldAttestationQueue();
    const a = attestation('maize', '2026', 5800);

    await queue.enqueue(a);

    expect(await queue.peek('maize', '2026')).toEqual(a);
  });

  it('does not confuse the same crop across different seasons', async () => {
    const queue = new InMemoryYieldAttestationQueue();
    await queue.enqueue(attestation('maize', '2026', 5800));

    expect(await queue.peek('maize', '2027')).toBeUndefined();
  });

  it('a later enqueue for the same crop/season supersedes the earlier one', async () => {
    const queue = new InMemoryYieldAttestationQueue();
    await queue.enqueue(attestation('maize', '2026', 5800));
    const revised = attestation('maize', '2026', 5850);
    await queue.enqueue(revised);

    expect(await queue.peek('maize', '2026')).toEqual(revised);
  });

  it('peek does not remove the entry (repeated checks see the same attestation)', async () => {
    const queue = new InMemoryYieldAttestationQueue();
    const a = attestation('maize', '2026', 5800);
    await queue.enqueue(a);

    await queue.peek('maize', '2026');
    expect(await queue.peek('maize', '2026')).toEqual(a);
  });
});
