import { PrismaService } from '../prisma/prisma.service';
import { WebhookDispatchService } from './webhook-dispatch.service';
import { InvoiceEvent } from './webhook-event.types';

function makeSubscription(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sub-1',
    ownerId: 'GFARMER',
    url: 'https://example.com/hook',
    secret: 'abc',
    eventTypes: ['*'],
    active: true,
    ...overrides,
  };
}

function buildPrisma() {
  return {
    webhookSubscription: { findMany: jest.fn().mockResolvedValue([]) },
    webhookDelivery: { create: jest.fn().mockResolvedValue({}) },
  } as unknown as PrismaService;
}

const EVENT: InvoiceEvent = {
  invoiceId: '7',
  event: 'repaid',
  timestamp: '2026-08-19T12:00:00.000Z',
};

describe('WebhookDispatchService', () => {
  it('only queries active subscriptions', async () => {
    const prisma = buildPrisma();
    const service = new WebhookDispatchService(prisma);

    await service.dispatchInvoiceEvent(EVENT);

    expect(prisma.webhookSubscription.findMany).toHaveBeenCalledWith({ where: { active: true } });
  });

  it('enqueues a delivery for a subscription with a matching event type', async () => {
    const prisma = buildPrisma();
    (prisma.webhookSubscription.findMany as jest.Mock).mockResolvedValue([
      makeSubscription({ eventTypes: ['repaid'] }),
    ]);
    const service = new WebhookDispatchService(prisma);

    const count = await service.dispatchInvoiceEvent(EVENT);

    expect(count).toBe(1);
    expect(prisma.webhookDelivery.create).toHaveBeenCalledTimes(1);
    const createArgs = (prisma.webhookDelivery.create as jest.Mock).mock.calls[0][0];
    expect(createArgs.data.subscriptionId).toBe('sub-1');
    expect(createArgs.data.eventType).toBe('repaid');
    expect(createArgs.data.payload).toEqual(EVENT);
  });

  it('enqueues for a wildcard subscription regardless of event type', async () => {
    const prisma = buildPrisma();
    (prisma.webhookSubscription.findMany as jest.Mock).mockResolvedValue([makeSubscription({ eventTypes: ['*'] })]);
    const service = new WebhookDispatchService(prisma);

    const count = await service.dispatchInvoiceEvent(EVENT);

    expect(count).toBe(1);
  });

  it('does not enqueue for a subscription with no matching event type', async () => {
    const prisma = buildPrisma();
    (prisma.webhookSubscription.findMany as jest.Mock).mockResolvedValue([
      makeSubscription({ eventTypes: ['funded'] }),
    ]);
    const service = new WebhookDispatchService(prisma);

    const count = await service.dispatchInvoiceEvent(EVENT);

    expect(count).toBe(0);
    expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
  });

  it('fans out to multiple interested subscriptions with the same idempotency key', async () => {
    const prisma = buildPrisma();
    (prisma.webhookSubscription.findMany as jest.Mock).mockResolvedValue([
      makeSubscription({ id: 'sub-1' }),
      makeSubscription({ id: 'sub-2' }),
    ]);
    const service = new WebhookDispatchService(prisma);

    const count = await service.dispatchInvoiceEvent(EVENT);

    expect(count).toBe(2);
    const calls = (prisma.webhookDelivery.create as jest.Mock).mock.calls;
    expect(calls[0][0].data.idempotencyKey).toBe(calls[1][0].data.idempotencyKey);
    expect(calls[0][0].data.subscriptionId).not.toBe(calls[1][0].data.subscriptionId);
  });

  it('suppresses (does not throw on) a duplicate enqueue for the same subscription+event', async () => {
    const prisma = buildPrisma();
    (prisma.webhookSubscription.findMany as jest.Mock).mockResolvedValue([makeSubscription()]);
    const uniqueViolation = Object.assign(new Error('duplicate'), { code: 'P2002' });
    (prisma.webhookDelivery.create as jest.Mock).mockRejectedValue(uniqueViolation);
    const service = new WebhookDispatchService(prisma);

    await expect(service.dispatchInvoiceEvent(EVENT)).resolves.toBe(0);
  });

  it('is a no-op when no subscription is interested', async () => {
    const prisma = buildPrisma();
    const service = new WebhookDispatchService(prisma);

    await expect(service.dispatchInvoiceEvent(EVENT)).resolves.toBe(0);
  });
});
