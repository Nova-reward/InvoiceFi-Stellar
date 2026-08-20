import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Principal } from '../compliance/principal';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookSubscriptionsService } from './webhook-subscriptions.service';

const FARMER: Principal = { userId: '1', walletAddress: 'GFARMER', role: 'farmer' };
const OTHER_FARMER: Principal = { userId: '2', walletAddress: 'GOTHER', role: 'farmer' };
const ADMIN: Principal = { userId: '3', walletAddress: 'GADMIN', role: 'admin' };

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sub-1',
    ownerId: 'GFARMER',
    url: 'https://example.com/hook',
    secret: 'abc123',
    eventTypes: ['*'],
    active: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildPrisma() {
  return {
    webhookSubscription: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  } as unknown as PrismaService;
}

describe('WebhookSubscriptionsService', () => {
  describe('register', () => {
    it('creates a subscription with a generated secret and returns it once', async () => {
      const prisma = buildPrisma();
      (prisma.webhookSubscription.create as jest.Mock).mockResolvedValue(makeRow());
      const service = new WebhookSubscriptionsService(prisma);

      const result = await service.register(FARMER, { url: 'https://example.com/hook' });

      expect(result.ownerId).toBe('GFARMER');
      const createArgs = (prisma.webhookSubscription.create as jest.Mock).mock.calls[0][0];
      // The secret returned to the caller is the one just generated and
      // persisted, not whatever the (mocked) create() call happens to echo back.
      expect(result.secret).toBe(createArgs.data.secret);
      expect(createArgs.data.ownerId).toBe('GFARMER');
      expect(createArgs.data.eventTypes).toEqual(['*']);
      expect(typeof createArgs.data.secret).toBe('string');
      expect(createArgs.data.secret.length).toBeGreaterThan(0);
    });

    it('defaults eventTypes to the wildcard when omitted', async () => {
      const prisma = buildPrisma();
      (prisma.webhookSubscription.create as jest.Mock).mockResolvedValue(makeRow());
      const service = new WebhookSubscriptionsService(prisma);

      await service.register(FARMER, { url: 'https://example.com/hook' });

      const createArgs = (prisma.webhookSubscription.create as jest.Mock).mock.calls[0][0];
      expect(createArgs.data.eventTypes).toEqual(['*']);
    });

    it('accepts a subset of valid event types', async () => {
      const prisma = buildPrisma();
      (prisma.webhookSubscription.create as jest.Mock).mockResolvedValue(makeRow());
      const service = new WebhookSubscriptionsService(prisma);

      await service.register(FARMER, { url: 'https://example.com/hook', eventTypes: ['funded', 'repaid'] });

      const createArgs = (prisma.webhookSubscription.create as jest.Mock).mock.calls[0][0];
      expect(createArgs.data.eventTypes.sort()).toEqual(['funded', 'repaid']);
    });

    it('rejects an invalid event type', async () => {
      const prisma = buildPrisma();
      const service = new WebhookSubscriptionsService(prisma);

      await expect(
        service.register(FARMER, { url: 'https://example.com/hook', eventTypes: ['not-a-real-event'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a private/loopback url (SSRF guard)', async () => {
      const prisma = buildPrisma();
      const service = new WebhookSubscriptionsService(prisma);

      await expect(
        service.register(FARMER, { url: 'http://127.0.0.1/hook' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects registration past the per-owner subscription cap', async () => {
      const prisma = buildPrisma();
      (prisma.webhookSubscription.count as jest.Mock).mockResolvedValue(20);
      const service = new WebhookSubscriptionsService(prisma);

      await expect(
        service.register(FARMER, { url: 'https://example.com/hook' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('list', () => {
    it('scopes non-admins to their own wallet', async () => {
      const prisma = buildPrisma();
      const service = new WebhookSubscriptionsService(prisma);

      await service.list(FARMER);

      expect(prisma.webhookSubscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ownerId: 'GFARMER' } }),
      );
    });

    it('lets admins see everything by default', async () => {
      const prisma = buildPrisma();
      const service = new WebhookSubscriptionsService(prisma);

      await service.list(ADMIN);

      expect(prisma.webhookSubscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('lets admins scope to a specific ownerId', async () => {
      const prisma = buildPrisma();
      const service = new WebhookSubscriptionsService(prisma);

      await service.list(ADMIN, 'GFARMER');

      expect(prisma.webhookSubscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ownerId: 'GFARMER' } }),
      );
    });
  });

  describe('findOwned', () => {
    it('returns the subscription for its owner', async () => {
      const prisma = buildPrisma();
      (prisma.webhookSubscription.findUnique as jest.Mock).mockResolvedValue(makeRow());
      const service = new WebhookSubscriptionsService(prisma);

      await expect(service.findOwned(FARMER, 'sub-1')).resolves.toMatchObject({ id: 'sub-1' });
    });

    it('lets an admin access any subscription', async () => {
      const prisma = buildPrisma();
      (prisma.webhookSubscription.findUnique as jest.Mock).mockResolvedValue(makeRow());
      const service = new WebhookSubscriptionsService(prisma);

      await expect(service.findOwned(ADMIN, 'sub-1')).resolves.toMatchObject({ id: 'sub-1' });
    });

    it('throws NotFoundException for a missing subscription', async () => {
      const prisma = buildPrisma();
      (prisma.webhookSubscription.findUnique as jest.Mock).mockResolvedValue(null);
      const service = new WebhookSubscriptionsService(prisma);

      await expect(service.findOwned(FARMER, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ForbiddenException for a non-owner, non-admin', async () => {
      const prisma = buildPrisma();
      (prisma.webhookSubscription.findUnique as jest.Mock).mockResolvedValue(makeRow());
      const service = new WebhookSubscriptionsService(prisma);

      await expect(service.findOwned(OTHER_FARMER, 'sub-1')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('revoke', () => {
    it('deactivates an owned subscription', async () => {
      const prisma = buildPrisma();
      (prisma.webhookSubscription.findUnique as jest.Mock).mockResolvedValue(makeRow());
      const service = new WebhookSubscriptionsService(prisma);

      await service.revoke(FARMER, 'sub-1');

      expect(prisma.webhookSubscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { active: false },
      });
    });

    it('is a no-op for an already-inactive subscription', async () => {
      const prisma = buildPrisma();
      (prisma.webhookSubscription.findUnique as jest.Mock).mockResolvedValue(makeRow({ active: false }));
      const service = new WebhookSubscriptionsService(prisma);

      await service.revoke(FARMER, 'sub-1');

      expect(prisma.webhookSubscription.update).not.toHaveBeenCalled();
    });

    it('rejects revoking someone else\'s subscription', async () => {
      const prisma = buildPrisma();
      (prisma.webhookSubscription.findUnique as jest.Mock).mockResolvedValue(makeRow());
      const service = new WebhookSubscriptionsService(prisma);

      await expect(service.revoke(OTHER_FARMER, 'sub-1')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
