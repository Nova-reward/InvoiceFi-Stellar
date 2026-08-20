import { ConfigService } from '@nestjs/config';
import { YieldAttestationQueue } from './yield-attestation-queue';
import { YieldAttestationStatus } from './yield-attestation.types';
import { InvoiceCropSeasonResolver } from './invoice-crop-season-resolver';
import { YieldGateService } from './yield-gate.service';

function config(enabled: boolean): ConfigService {
  return {
    get: (key: string) =>
      key === 'YIELD_GATE_ENABLED' ? String(enabled) : undefined,
  } as unknown as ConfigService;
}

function fakeQueue(): jest.Mocked<YieldAttestationQueue> {
  return {
    enqueue: jest.fn().mockResolvedValue(undefined),
    peek: jest.fn().mockResolvedValue(undefined),
  };
}

function fakeResolver(): jest.Mocked<InvoiceCropSeasonResolver> {
  return { resolve: jest.fn().mockResolvedValue(undefined) };
}

describe('YieldGateService', () => {
  it('allows settlement when the gate is disabled, regardless of association', async () => {
    const queue = fakeQueue();
    const resolver = fakeResolver();
    resolver.resolve.mockResolvedValue({ cropId: 'maize', seasonId: '2026' });
    const gate = new YieldGateService(queue, resolver, config(false));

    expect(await gate.isSettlementAllowed('inv-1')).toBe(true);
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(queue.peek).not.toHaveBeenCalled();
  });

  it('allows settlement when enabled but the invoice has no crop/season association', async () => {
    const queue = fakeQueue();
    const resolver = fakeResolver();
    const gate = new YieldGateService(queue, resolver, config(true));

    expect(await gate.isSettlementAllowed('inv-1')).toBe(true);
    expect(queue.peek).not.toHaveBeenCalled();
  });

  it('blocks settlement when gated and no attestation exists yet', async () => {
    const queue = fakeQueue();
    const resolver = fakeResolver();
    resolver.resolve.mockResolvedValue({ cropId: 'maize', seasonId: '2026' });
    const gate = new YieldGateService(queue, resolver, config(true));

    expect(await gate.isSettlementAllowed('inv-1')).toBe(false);
    expect(queue.peek).toHaveBeenCalledWith('maize', '2026');
  });

  it('blocks settlement when the attestation is DISPUTED', async () => {
    const queue = fakeQueue();
    queue.peek.mockResolvedValue({
      cropId: 'maize',
      seasonId: '2026',
      status: YieldAttestationStatus.DISPUTED,
      readings: [],
      reconciledAt: new Date(),
      notes: 'sources disagreed',
    });
    const resolver = fakeResolver();
    resolver.resolve.mockResolvedValue({ cropId: 'maize', seasonId: '2026' });
    const gate = new YieldGateService(queue, resolver, config(true));

    expect(await gate.isSettlementAllowed('inv-1')).toBe(false);
  });

  it('blocks settlement when the attestation is INSUFFICIENT_DATA', async () => {
    const queue = fakeQueue();
    queue.peek.mockResolvedValue({
      cropId: 'maize',
      seasonId: '2026',
      status: YieldAttestationStatus.INSUFFICIENT_DATA,
      readings: [],
      reconciledAt: new Date(),
      notes: 'no source responded',
    });
    const resolver = fakeResolver();
    resolver.resolve.mockResolvedValue({ cropId: 'maize', seasonId: '2026' });
    const gate = new YieldGateService(queue, resolver, config(true));

    expect(await gate.isSettlementAllowed('inv-1')).toBe(false);
  });

  it('allows settlement when gated and the attestation is RECONCILED', async () => {
    const queue = fakeQueue();
    queue.peek.mockResolvedValue({
      cropId: 'maize',
      seasonId: '2026',
      status: YieldAttestationStatus.RECONCILED,
      finalYieldKgPerHectare: 5800,
      readings: [],
      reconciledAt: new Date(),
      notes: 'agreed',
    });
    const resolver = fakeResolver();
    resolver.resolve.mockResolvedValue({ cropId: 'maize', seasonId: '2026' });
    const gate = new YieldGateService(queue, resolver, config(true));

    expect(await gate.isSettlementAllowed('inv-1')).toBe(true);
  });
});
