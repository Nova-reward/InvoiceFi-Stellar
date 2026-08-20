import { PrismaService } from '../prisma/prisma.service';
import { RETRY_SCHEDULE_MS } from './retry-schedule';
import { verifyWebhookSignature, WEBHOOK_SIGNATURE_HEADER } from './webhook-signing';
import { WebhookDeliveryWorkerService } from './webhook-delivery-worker.service';

function makeClaimed(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'del-1',
    subscriptionId: 'sub-1',
    eventType: 'repaid',
    payload: { invoiceId: '7', event: 'repaid', timestamp: '2026-08-19T12:00:00.000Z' },
    attemptCount: 0,
    ...overrides,
  };
}

function makeSubscription(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sub-1',
    ownerId: 'GFARMER',
    url: 'https://example.com/hook',
    secret: 'top-secret',
    eventTypes: ['*'],
    active: true,
    ...overrides,
  };
}

function buildPrisma() {
  return {
    db: { $queryRaw: jest.fn().mockResolvedValue([]) },
    webhookSubscription: { findUnique: jest.fn() },
    webhookDelivery: { update: jest.fn().mockResolvedValue({}) },
    webhookDeliveryAttempt: { create: jest.fn().mockResolvedValue({}) },
  } as unknown as PrismaService;
}

describe('WebhookDeliveryWorkerService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('delivers a due delivery, signs the request, and marks it DELIVERED', async () => {
    const prisma = buildPrisma();
    (prisma.db.$queryRaw as jest.Mock).mockResolvedValue([makeClaimed()]);
    (prisma.webhookSubscription.findUnique as jest.Mock).mockResolvedValue(makeSubscription());
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;

    const worker = new WebhookDeliveryWorkerService(prisma);
    const attempted = await worker.processDueDeliveries();

    expect(attempted).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.com/hook');
    expect(init.method).toBe('POST');
    const signature = init.headers[WEBHOOK_SIGNATURE_HEADER];
    expect(verifyWebhookSignature('top-secret', init.body, signature)).toBe(true);

    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: 'del-1' },
      data: expect.objectContaining({ status: 'DELIVERED', attemptCount: 1, lastStatusCode: 200 }),
    });
    expect(prisma.webhookDeliveryAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ deliveryId: 'del-1', attemptNumber: 1, success: true, statusCode: 200 }),
    });
  });

  it('schedules a retry per the backoff schedule on a non-2xx response', async () => {
    const prisma = buildPrisma();
    (prisma.db.$queryRaw as jest.Mock).mockResolvedValue([makeClaimed({ attemptCount: 1 })]);
    (prisma.webhookSubscription.findUnique as jest.Mock).mockResolvedValue(makeSubscription());
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;

    const worker = new WebhookDeliveryWorkerService(prisma);
    const before = Date.now();
    await worker.processDueDeliveries();

    const update = (prisma.webhookDelivery.update as jest.Mock).mock.calls[0][0];
    expect(update.data.status).toBe('PENDING');
    expect(update.data.attemptCount).toBe(2);
    // attempt 2 failed -> next delay is RETRY_SCHEDULE_MS[1] (5m)
    const expectedDelay = RETRY_SCHEDULE_MS[1];
    const nextAttemptAt = update.data.nextAttemptAt as Date;
    expect(nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + expectedDelay);

    const attempt = (prisma.webhookDeliveryAttempt.create as jest.Mock).mock.calls[0][0];
    expect(attempt.data.success).toBe(false);
    expect(attempt.data.statusCode).toBe(500);
  });

  it('abandons a delivery after the retry schedule is exhausted', async () => {
    const prisma = buildPrisma();
    // attemptCount 6 -> this attempt is #7, the last one per MAX_DELIVERY_ATTEMPTS.
    (prisma.db.$queryRaw as jest.Mock).mockResolvedValue([makeClaimed({ attemptCount: 6 })]);
    (prisma.webhookSubscription.findUnique as jest.Mock).mockResolvedValue(makeSubscription());
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;

    const worker = new WebhookDeliveryWorkerService(prisma);
    await worker.processDueDeliveries();

    const update = (prisma.webhookDelivery.update as jest.Mock).mock.calls[0][0];
    expect(update.data.status).toBe('ABANDONED');
    expect(update.data.attemptCount).toBe(7);
  });

  it('treats a network error / timeout like a failed attempt and retries', async () => {
    const prisma = buildPrisma();
    (prisma.db.$queryRaw as jest.Mock).mockResolvedValue([makeClaimed()]);
    (prisma.webhookSubscription.findUnique as jest.Mock).mockResolvedValue(makeSubscription());
    global.fetch = jest.fn().mockRejectedValue(new Error('fetch failed')) as unknown as typeof fetch;

    const worker = new WebhookDeliveryWorkerService(prisma);
    await worker.processDueDeliveries();

    const update = (prisma.webhookDelivery.update as jest.Mock).mock.calls[0][0];
    expect(update.data.status).toBe('PENDING');
    expect(update.data.lastError).toContain('fetch failed');
  });

  it('recovers once the subscriber comes back up: a later successful attempt marks DELIVERED', async () => {
    const prisma = buildPrisma();
    (prisma.db.$queryRaw as jest.Mock).mockResolvedValue([makeClaimed({ attemptCount: 3 })]);
    (prisma.webhookSubscription.findUnique as jest.Mock).mockResolvedValue(makeSubscription());
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch;

    const worker = new WebhookDeliveryWorkerService(prisma);
    await worker.processDueDeliveries();

    const update = (prisma.webhookDelivery.update as jest.Mock).mock.calls[0][0];
    expect(update.data.status).toBe('DELIVERED');
    expect(update.data.attemptCount).toBe(4);
  });

  it('abandons without an HTTP call when the subscription was revoked mid-flight', async () => {
    const prisma = buildPrisma();
    (prisma.db.$queryRaw as jest.Mock).mockResolvedValue([makeClaimed()]);
    (prisma.webhookSubscription.findUnique as jest.Mock).mockResolvedValue(makeSubscription({ active: false }));
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const worker = new WebhookDeliveryWorkerService(prisma);
    await worker.processDueDeliveries();

    expect(fetchMock).not.toHaveBeenCalled();
    const update = (prisma.webhookDelivery.update as jest.Mock).mock.calls[0][0];
    expect(update.data.status).toBe('ABANDONED');
  });

  it('processes a batch of due deliveries concurrently', async () => {
    const prisma = buildPrisma();
    (prisma.db.$queryRaw as jest.Mock).mockResolvedValue([
      makeClaimed({ id: 'del-1', subscriptionId: 'sub-1' }),
      makeClaimed({ id: 'del-2', subscriptionId: 'sub-2' }),
    ]);
    (prisma.webhookSubscription.findUnique as jest.Mock).mockImplementation(({ where }) =>
      Promise.resolve(makeSubscription({ id: where.id })),
    );
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch;

    const worker = new WebhookDeliveryWorkerService(prisma);
    const attempted = await worker.processDueDeliveries();

    expect(attempted).toBe(2);
    expect(prisma.webhookDelivery.update).toHaveBeenCalledTimes(2);
  });

  it('does nothing when no deliveries are due', async () => {
    const prisma = buildPrisma();
    (prisma.db.$queryRaw as jest.Mock).mockResolvedValue([]);
    const worker = new WebhookDeliveryWorkerService(prisma);

    await expect(worker.processDueDeliveries()).resolves.toBe(0);
    expect(prisma.webhookSubscription.findUnique).not.toHaveBeenCalled();
  });

  it('does not overlap polls: a poll already in flight skips the next tick', async () => {
    const prisma = buildPrisma();
    let resolveQuery: (value: unknown[]) => void;
    (prisma.db.$queryRaw as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveQuery = resolve;
      }),
    );
    const worker = new WebhookDeliveryWorkerService(prisma);

    const firstPoll = worker.poll();
    await worker.poll(); // should return immediately (no-op) since a poll is already running
    resolveQuery!([]);
    await firstPoll;

    expect(prisma.db.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
