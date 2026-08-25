import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookDeliveryLogService } from './webhook-delivery-log.service';

function makeDelivery(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'del-1',
    subscriptionId: 'sub-1',
    eventType: 'repaid',
    status: 'DELIVERED',
    attemptCount: 1,
    nextAttemptAt: new Date('2026-08-19T12:00:00.000Z'),
    lastAttemptAt: new Date('2026-08-19T12:00:01.000Z'),
    lastStatusCode: 200,
    lastError: null,
    createdAt: new Date('2026-08-19T11:59:00.000Z'),
    updatedAt: new Date('2026-08-19T12:00:01.000Z'),
    attempts: [
      {
        attemptNumber: 1,
        attemptedAt: new Date('2026-08-19T12:00:01.000Z'),
        success: true,
        statusCode: 200,
        error: null,
        durationMs: 42,
      },
    ],
    ...overrides,
  };
}

function buildPrisma() {
  return {
    webhookDelivery: { findMany: jest.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;
}

describe('WebhookDeliveryLogService', () => {
  it('lists deliveries for a subscription, newest first, with attempts', async () => {
    const prisma = buildPrisma();
    (prisma.webhookDelivery.findMany as jest.Mock).mockResolvedValue([makeDelivery()]);
    const service = new WebhookDeliveryLogService(prisma);

    const result = await service.listForSubscription('sub-1');

    expect(prisma.webhookDelivery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { subscriptionId: 'sub-1' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    );
    expect(result[0].attempts).toHaveLength(1);
    expect(result[0].attempts[0].success).toBe(true);
  });

  it('filters by a valid status', async () => {
    const prisma = buildPrisma();
    const service = new WebhookDeliveryLogService(prisma);

    await service.listForSubscription('sub-1', { status: 'ABANDONED' });

    expect(prisma.webhookDelivery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { subscriptionId: 'sub-1', status: 'ABANDONED' } }),
    );
  });

  it('rejects an invalid status', async () => {
    const prisma = buildPrisma();
    const service = new WebhookDeliveryLogService(prisma);

    await expect(
      service.listForSubscription('sub-1', { status: 'NOT_A_STATUS' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('clamps limit to [1, 200] and defaults to 50', async () => {
    const prisma = buildPrisma();
    const service = new WebhookDeliveryLogService(prisma);

    await service.listForSubscription('sub-1', { limit: 10_000 });
    expect((prisma.webhookDelivery.findMany as jest.Mock).mock.calls[0][0].take).toBe(200);

    await service.listForSubscription('sub-1', { limit: 0 });
    expect((prisma.webhookDelivery.findMany as jest.Mock).mock.calls[1][0].take).toBe(1);

    await service.listForSubscription('sub-1', {});
    expect((prisma.webhookDelivery.findMany as jest.Mock).mock.calls[2][0].take).toBe(50);
  });
});
