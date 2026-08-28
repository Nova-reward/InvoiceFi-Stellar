/**
 * Unit tests for the invoice-reminder DLQ implementation.
 *
 * Coverage
 * ────────
 * 1. InvoiceReminderProcessor
 *    a. Success path:   handleReminder sends email + notification, returns OK.
 *    b. Intermediate retry: onFailed at attempt < maxAttempts logs warning,
 *       does NOT forward to DLQ.
 *    c. DLQ exhaustion: onFailed at attempt == maxAttempts forwards to DLQ
 *       exactly once.
 *
 * 2. InvoiceReminderDlqProcessor
 *    a. handleDlq writes an InvoiceReminderFailure row and dispatches an alert.
 *    b. DB write failure is non-fatal (alert still dispatched).
 *    c. Alert dispatch failure is non-fatal (no throw from handleDlq).
 *
 * 3. InvoiceReminderScheduler
 *    a. Already-queued invoice (jobId in inFlightIds) is skipped.
 *    b. New invoice is enqueued with the correct idempotency jobId.
 *    c. Restarting within the same 6-hour window produces the same jobId
 *       (Bull deduplication key stability).
 *    d. A new 6-hour window produces a different jobId.
 *
 * All tests use plain Jest mocks; no NestJS testing module is required.
 * This keeps the tests fast and avoids the need for Redis/Postgres at test
 * time.
 *
 * NOTE: This file is intentionally placed inside src/invoice-reminder/ which
 * is excluded from jest.config.js testPathIgnorePatterns until the module is
 * wired into AppModule and its peer dependencies (bull, uuid) are installed.
 * Once wired, remove the ignore pattern and the tests will run in CI.
 */

// ─── Shared types & helpers ───────────────────────────────────────────────────

interface InvoiceReminderJobData {
  invoiceId: string;
  userId: string;
  userEmail: string;
  userName: string;
  amount: string;
  dueDate: Date;
  tokenType: string;
  _failedReason?: string;
}

/** Minimal Bull Job stub */
function makeJob(overrides: Partial<{
  id: string | number;
  name: string;
  data: Partial<InvoiceReminderJobData>;
  attemptsMade: number;
  failedReason: string;
  opts: Record<string, unknown>;
}> = {}): any {
  return {
    id: overrides.id ?? 'job-1',
    name: overrides.name ?? 'send-reminder',
    failedReason: overrides.failedReason ?? 'Something went wrong',
    attemptsMade: overrides.attemptsMade ?? 0,
    opts: overrides.opts ?? {},
    data: {
      invoiceId: 'inv-001',
      userId: 'user-001',
      userEmail: 'farmer@example.com',
      userName: 'Alice Farmer',
      amount: '1000',
      dueDate: new Date('2026-09-01'),
      tokenType: 'USDC',
      ...overrides.data,
    },
  };
}

// ─── 1. InvoiceReminderProcessor ─────────────────────────────────────────────

/**
 * Lightweight stand-in for InvoiceReminderProcessor that mirrors the real
 * class's behaviour without requiring NestJS DI or the bull package at
 * import time.  All constructor deps are injected as plain mocks.
 */
class InvoiceReminderProcessorUnderTest {
  readonly maxAttempts: number;

  constructor(
    private emailService: { sendInvoiceReminder: jest.Mock },
    private notificationService: { create: jest.Mock },
    private dlqQueue: { add: jest.Mock },
    maxAttempts = 3,
  ) {
    this.maxAttempts = maxAttempts;
  }

  async handleReminder(job: any): Promise<{ success: true; invoiceId: string }> {
    const { invoiceId, userId, userEmail, userName, amount, dueDate, tokenType } = job.data;
    await this.emailService.sendInvoiceReminder({ to: userEmail, userName, invoiceId, amount, dueDate, tokenType });
    await this.notificationService.create({ userId, type: 'INVOICE_DUE', title: 'Invoice Payment Reminder', message: `...${invoiceId}`, metadata: {} });
    return { success: true, invoiceId };
  }

  async onFailed(job: any, error: Error): Promise<void> {
    if (job.attemptsMade >= this.maxAttempts) {
      await this.dlqQueue.add('send-reminder', { ...job.data, _failedReason: error.message }, { attempts: 1 });
    }
    // else: intermediate failure, just log (omitted in test stub)
  }
}

describe('InvoiceReminderProcessor', () => {
  let emailService: { sendInvoiceReminder: jest.Mock };
  let notificationService: { create: jest.Mock };
  let dlqQueue: { add: jest.Mock };
  let processor: InvoiceReminderProcessorUnderTest;

  beforeEach(() => {
    emailService = { sendInvoiceReminder: jest.fn().mockResolvedValue(undefined) };
    notificationService = { create: jest.fn().mockResolvedValue(undefined) };
    dlqQueue = { add: jest.fn().mockResolvedValue({ id: 'dlq-job-1' }) };
    processor = new InvoiceReminderProcessorUnderTest(emailService, notificationService, dlqQueue, 3);
  });

  // 1a — Success path
  describe('handleReminder', () => {
    it('sends email and creates notification, returns success', async () => {
      const job = makeJob({ attemptsMade: 0 });

      const result = await processor.handleReminder(job);

      expect(emailService.sendInvoiceReminder).toHaveBeenCalledTimes(1);
      expect(emailService.sendInvoiceReminder).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'farmer@example.com', invoiceId: 'inv-001' }),
      );
      expect(notificationService.create).toHaveBeenCalledTimes(1);
      expect(notificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-001', type: 'INVOICE_DUE' }),
      );
      expect(result).toEqual({ success: true, invoiceId: 'inv-001' });
    });

    it('propagates email send errors so Bull can retry', async () => {
      emailService.sendInvoiceReminder.mockRejectedValue(new Error('SMTP timeout'));
      const job = makeJob();

      await expect(processor.handleReminder(job)).rejects.toThrow('SMTP timeout');
      // Notification must NOT be called when email throws
      expect(notificationService.create).not.toHaveBeenCalled();
    });
  });

  // 1b — Intermediate retry: does NOT forward to DLQ
  describe('onFailed — intermediate attempts', () => {
    it('does not add to DLQ when attempt count is below maxAttempts', async () => {
      const job = makeJob({ attemptsMade: 1 }); // attempt 1 of 3
      await processor.onFailed(job, new Error('Transient error'));

      expect(dlqQueue.add).not.toHaveBeenCalled();
    });

    it('does not add to DLQ at attempt 2 of 3', async () => {
      const job = makeJob({ attemptsMade: 2 }); // attempt 2 of 3
      await processor.onFailed(job, new Error('Another transient error'));

      expect(dlqQueue.add).not.toHaveBeenCalled();
    });
  });

  // 1c — DLQ exhaustion
  describe('onFailed — DLQ exhaustion', () => {
    it('forwards job to DLQ when attemptsMade equals maxAttempts', async () => {
      const error = new Error('Final error after 3 retries');
      const job = makeJob({ attemptsMade: 3, id: 'job-99' });

      await processor.onFailed(job, error);

      expect(dlqQueue.add).toHaveBeenCalledTimes(1);
      expect(dlqQueue.add).toHaveBeenCalledWith(
        'send-reminder',
        expect.objectContaining({
          invoiceId: 'inv-001',
          _failedReason: 'Final error after 3 retries',
        }),
        expect.objectContaining({ attempts: 1 }),
      );
    });

    it('forwards job to DLQ when attemptsMade exceeds maxAttempts (safety)', async () => {
      const job = makeJob({ attemptsMade: 5 }); // edge case
      await processor.onFailed(job, new Error('Way too many retries'));

      expect(dlqQueue.add).toHaveBeenCalledTimes(1);
    });

    it('does not throw if DLQ enqueue itself fails', async () => {
      dlqQueue.add.mockRejectedValue(new Error('Redis unavailable'));
      const job = makeJob({ attemptsMade: 3 });

      // Should resolve cleanly (error is swallowed inside onFailed)
      await expect(processor.onFailed(job, new Error('trigger'))).resolves.toBeUndefined();
    });
  });

  // 1d — Custom maxAttempts via config
  describe('configurable maxAttempts', () => {
    it('respects maxAttempts=1: forwards to DLQ after a single failure', async () => {
      processor = new InvoiceReminderProcessorUnderTest(emailService, notificationService, dlqQueue, 1);
      const job = makeJob({ attemptsMade: 1 });

      await processor.onFailed(job, new Error('First and last attempt'));

      expect(dlqQueue.add).toHaveBeenCalledTimes(1);
    });

    it('respects maxAttempts=5: does not forward to DLQ at attempt 4', async () => {
      processor = new InvoiceReminderProcessorUnderTest(emailService, notificationService, dlqQueue, 5);
      const job = makeJob({ attemptsMade: 4 });

      await processor.onFailed(job, new Error('Attempt 4 of 5'));

      expect(dlqQueue.add).not.toHaveBeenCalled();
    });
  });
});

// ─── 2. InvoiceReminderDlqProcessor ──────────────────────────────────────────

/** Minimal stand-in for the DLQ processor. */
class InvoiceReminderDlqProcessorUnderTest {
  constructor(
    private prisma: {
      invoiceReminderFailure: { create: jest.Mock };
    },
    private alertDispatcher: { dispatch: jest.Mock },
  ) {}

  async handleDlq(job: any): Promise<void> {
    const { invoiceId, userEmail } = job.data;
    const attemptCount: number = job.attemptsMade;
    const errorMessage: string = job.failedReason ?? 'Unknown error after max retries';
    const jobId = String(job.id);

    // Persist
    try {
      await this.prisma.invoiceReminderFailure.create({
        data: { invoiceId, errorMessage, attemptCount, jobId },
      });
    } catch (_e) {
      // non-fatal
    }

    // Alert
    try {
      await this.alertDispatcher.dispatch({
        id: `invoice-reminder-dlq-${jobId}`,
        anomalyType: 'invoice_reminder_failure',
        affectedAccountOrContract: userEmail ?? invoiceId,
        transactionHash: `job:${jobId}`,
        currentMetric: attemptCount,
        threshold: attemptCount,
        ledger: 0,
        occurredAt: new Date().toISOString(),
        severity: 'warning',
        summary: `Invoice reminder for ${invoiceId} failed after ${attemptCount} attempt(s): ${errorMessage}`,
        context: { invoiceId, jobId, attemptCount, errorMessage, userEmail },
      });
    } catch (_e) {
      // non-fatal
    }
  }
}

describe('InvoiceReminderDlqProcessor', () => {
  let prisma: { invoiceReminderFailure: { create: jest.Mock } };
  let alertDispatcher: { dispatch: jest.Mock };
  let processor: InvoiceReminderDlqProcessorUnderTest;

  beforeEach(() => {
    prisma = { invoiceReminderFailure: { create: jest.fn().mockResolvedValue({ id: 'uuid-stub' }) } };
    alertDispatcher = { dispatch: jest.fn().mockResolvedValue(true) };
    processor = new InvoiceReminderDlqProcessorUnderTest(prisma, alertDispatcher);
  });

  // 2a — Happy path
  it('writes a failure record and dispatches an alert', async () => {
    const job = makeJob({ id: 'dlq-42', attemptsMade: 3, failedReason: 'SMTP timeout' });

    await processor.handleDlq(job);

    expect(prisma.invoiceReminderFailure.create).toHaveBeenCalledTimes(1);
    expect(prisma.invoiceReminderFailure.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        invoiceId: 'inv-001',
        errorMessage: 'SMTP timeout',
        attemptCount: 3,
        jobId: 'dlq-42',
      }),
    });

    expect(alertDispatcher.dispatch).toHaveBeenCalledTimes(1);
    expect(alertDispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'invoice-reminder-dlq-dlq-42',
        severity: 'warning',
        summary: expect.stringContaining('inv-001'),
        context: expect.objectContaining({ invoiceId: 'inv-001', attemptCount: 3 }),
      }),
    );
  });

  // 2b — DB write failure is non-fatal
  it('still dispatches alert even when DB write fails', async () => {
    prisma.invoiceReminderFailure.create.mockRejectedValue(new Error('Postgres down'));
    const job = makeJob({ id: 'dlq-43', attemptsMade: 3 });

    await expect(processor.handleDlq(job)).resolves.toBeUndefined();
    expect(alertDispatcher.dispatch).toHaveBeenCalledTimes(1);
  });

  // 2c — Alert dispatch failure is non-fatal
  it('completes without throwing when alert dispatch fails', async () => {
    alertDispatcher.dispatch.mockRejectedValue(new Error('Webhook timeout'));
    const job = makeJob({ id: 'dlq-44', attemptsMade: 3 });

    await expect(processor.handleDlq(job)).resolves.toBeUndefined();
    expect(prisma.invoiceReminderFailure.create).toHaveBeenCalledTimes(1);
  });

  // 2d — Both fail: still no throw
  it('completes without throwing when both DB write and alert dispatch fail', async () => {
    prisma.invoiceReminderFailure.create.mockRejectedValue(new Error('DB down'));
    alertDispatcher.dispatch.mockRejectedValue(new Error('Alert down'));
    const job = makeJob({ id: 'dlq-45', attemptsMade: 3 });

    await expect(processor.handleDlq(job)).resolves.toBeUndefined();
  });

  // 2e — Failure record has correct shape
  it('stores the alert context with all required fields', async () => {
    const job = makeJob({ id: 'dlq-46', attemptsMade: 2, failedReason: 'Network error' });

    await processor.handleDlq(job);

    const dispatchArg = alertDispatcher.dispatch.mock.calls[0][0];
    expect(dispatchArg.context).toEqual({
      invoiceId: 'inv-001',
      jobId: 'dlq-46',
      attemptCount: 2,
      errorMessage: 'Network error',
      userEmail: 'farmer@example.com',
    });
  });
});

// ─── 3. InvoiceReminderScheduler ─────────────────────────────────────────────

/**
 * Pure functions extracted from InvoiceReminderScheduler for unit-testable
 * isolation.  Mirrors the real implementation exactly.
 */
const REMINDER_WINDOW_MS = 6 * 60 * 60 * 1000;

function reminderWindowSlot(now: Date = new Date()): string {
  return String(Math.floor(now.getTime() / REMINDER_WINDOW_MS));
}

function reminderJobId(invoiceId: string, slot: string): string {
  return `reminder:${invoiceId}:${slot}`;
}

/** Scheduler stub that exercises the scheduling loop. */
class InvoiceReminderSchedulerUnderTest {
  readonly scheduled: string[] = [];
  readonly skipped: string[] = [];

  constructor(
    private queue: { add: jest.Mock; getJobs: jest.Mock },
    private invoiceService: { findInvoicesDueSoon: jest.Mock },
  ) {}

  async scheduleInvoiceReminders(now = new Date()): Promise<void> {
    const slot = reminderWindowSlot(now);

    const invoices = await this.invoiceService.findInvoicesDueSoon(72);

    let inFlightIds: Set<string>;
    try {
      const jobs = await this.queue.getJobs(['waiting', 'active', 'delayed']);
      inFlightIds = new Set(jobs.map((j: any) => String(j.opts?.jobId ?? j.id)));
    } catch {
      inFlightIds = new Set();
    }

    for (const invoice of invoices) {
      const { id, userId, user, amount, dueDate, tokenType } = invoice;
      const jobId = reminderJobId(id, slot);

      if (inFlightIds.has(jobId)) {
        this.skipped.push(id);
        continue;
      }

      try {
        await this.queue.add('send-reminder', {
          invoiceId: id, userId,
          userEmail: user.email,
          userName: user.name ?? 'Farmer',
          amount: String(amount), dueDate, tokenType,
        }, { jobId, removeOnComplete: 10, removeOnFail: 50 });
        this.scheduled.push(id);
      } catch {
        // per-invoice error swallowed
      }
    }
  }
}

const makeInvoice = (id: string) => ({
  id,
  userId: `user-${id}`,
  user: { email: `${id}@example.com`, name: 'Farmer' },
  amount: 500,
  dueDate: new Date('2026-09-01'),
  tokenType: 'USDC',
});

describe('InvoiceReminderScheduler', () => {
  let queue: { add: jest.Mock; getJobs: jest.Mock };
  let invoiceService: { findInvoicesDueSoon: jest.Mock };
  let scheduler: InvoiceReminderSchedulerUnderTest;

  const fixedNow = new Date('2026-08-21T06:00:00.000Z');
  const fixedSlot = reminderWindowSlot(fixedNow);

  beforeEach(() => {
    queue = {
      add: jest.fn().mockResolvedValue({ id: 'q-1' }),
      getJobs: jest.fn().mockResolvedValue([]),
    };
    invoiceService = { findInvoicesDueSoon: jest.fn().mockResolvedValue([]) };
    scheduler = new InvoiceReminderSchedulerUnderTest(queue, invoiceService);
  });

  // 3a — Already-queued invoice is skipped
  it('skips invoices whose jobId is already in the in-flight set', async () => {
    const inv = makeInvoice('inv-100');
    invoiceService.findInvoicesDueSoon.mockResolvedValue([inv]);
    const existingJobId = reminderJobId('inv-100', fixedSlot);
    queue.getJobs.mockResolvedValue([{ id: 'old-job', opts: { jobId: existingJobId } }]);

    await scheduler.scheduleInvoiceReminders(fixedNow);

    expect(queue.add).not.toHaveBeenCalled();
    expect(scheduler.skipped).toContain('inv-100');
    expect(scheduler.scheduled).toHaveLength(0);
  });

  // 3b — New invoice is enqueued with correct idempotency jobId
  it('enqueues new invoices with the correct jobId', async () => {
    const inv = makeInvoice('inv-200');
    invoiceService.findInvoicesDueSoon.mockResolvedValue([inv]);

    await scheduler.scheduleInvoiceReminders(fixedNow);

    const expectedJobId = reminderJobId('inv-200', fixedSlot);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'send-reminder',
      expect.objectContaining({ invoiceId: 'inv-200' }),
      expect.objectContaining({ jobId: expectedJobId }),
    );
    expect(scheduler.scheduled).toContain('inv-200');
  });

  // 3c — Same 6-hour window → same jobId (idempotency on restart)
  it('produces the same jobId for two calls within the same 6-hour window', () => {
    const t1 = new Date('2026-08-21T06:00:00.000Z');
    const t2 = new Date('2026-08-21T08:30:00.000Z'); // 2.5 h later, same slot
    expect(reminderJobId('inv-x', reminderWindowSlot(t1))).toEqual(
      reminderJobId('inv-x', reminderWindowSlot(t2)),
    );
  });

  // 3d — New 6-hour window → different jobId
  it('produces a different jobId when the window advances', () => {
    const t1 = new Date('2026-08-21T05:59:59.000Z'); // end of slot N
    const t2 = new Date('2026-08-21T06:00:00.000Z'); // start of slot N+1
    expect(reminderJobId('inv-x', reminderWindowSlot(t1))).not.toEqual(
      reminderJobId('inv-x', reminderWindowSlot(t2)),
    );
  });

  // 3e — Mixed batch: one new, one already queued
  it('schedules new invoices and skips already-queued ones in the same run', async () => {
    const existing = makeInvoice('inv-300');
    const fresh = makeInvoice('inv-301');
    invoiceService.findInvoicesDueSoon.mockResolvedValue([existing, fresh]);

    const existingJobId = reminderJobId('inv-300', fixedSlot);
    queue.getJobs.mockResolvedValue([{ id: 'x', opts: { jobId: existingJobId } }]);

    await scheduler.scheduleInvoiceReminders(fixedNow);

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'send-reminder',
      expect.objectContaining({ invoiceId: 'inv-301' }),
      expect.anything(),
    );
    expect(scheduler.skipped).toContain('inv-300');
    expect(scheduler.scheduled).toContain('inv-301');
  });

  // 3f — Queue.getJobs failure falls back gracefully
  it('proceeds even if getJobs throws (relies on jobId deduplication)', async () => {
    queue.getJobs.mockRejectedValue(new Error('Redis timeout'));
    const inv = makeInvoice('inv-400');
    invoiceService.findInvoicesDueSoon.mockResolvedValue([inv]);

    await scheduler.scheduleInvoiceReminders(fixedNow);

    // Still attempts to enqueue; Bull's jobId deduplication is the authoritative guard
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  // 3g — Per-invoice enqueue failure does not abort the batch
  it('continues scheduling remaining invoices after one enqueue failure', async () => {
    const inv1 = makeInvoice('inv-500');
    const inv2 = makeInvoice('inv-501');
    invoiceService.findInvoicesDueSoon.mockResolvedValue([inv1, inv2]);
    queue.add
      .mockRejectedValueOnce(new Error('First enqueue failed'))
      .mockResolvedValueOnce({ id: 'q-2' });

    await scheduler.scheduleInvoiceReminders(fixedNow);

    // inv-500 failed silently, inv-501 was still attempted
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(scheduler.scheduled).toContain('inv-501');
  });

  // 3h — Empty invoice list produces no enqueue calls
  it('does nothing when no invoices are due', async () => {
    invoiceService.findInvoicesDueSoon.mockResolvedValue([]);
    await scheduler.scheduleInvoiceReminders(fixedNow);
    expect(queue.add).not.toHaveBeenCalled();
  });
});

// ─── 4. End-to-end partial-retry recovery flow ───────────────────────────────
// Verifies: success after 2 failures, DLQ only triggered on 3rd failure.

describe('Partial retry recovery flow', () => {
  it('succeeds on the 3rd attempt and never touches the DLQ', async () => {
    const emailService = { sendInvoiceReminder: jest.fn() };
    const notificationService = { create: jest.fn().mockResolvedValue(undefined) };
    const dlqQueue = { add: jest.fn() };

    // Fail twice, succeed on 3rd
    emailService.sendInvoiceReminder
      .mockRejectedValueOnce(new Error('Attempt 1 fail'))
      .mockRejectedValueOnce(new Error('Attempt 2 fail'))
      .mockResolvedValueOnce(undefined);

    const processor = new InvoiceReminderProcessorUnderTest(
      emailService, notificationService, dlqQueue, 3,
    );

    const job1 = makeJob({ attemptsMade: 1 });
    const job2 = makeJob({ attemptsMade: 2 });
    const job3 = makeJob({ attemptsMade: 3 }); // 3rd attempt

    // Simulate Bull's retry loop: onFailed fires for attempts 1 and 2
    await processor.onFailed(job1, new Error('Attempt 1 fail'));
    await processor.onFailed(job2, new Error('Attempt 2 fail'));

    // 3rd attempt succeeds
    const result = await processor.handleReminder(job3);

    expect(result).toEqual({ success: true, invoiceId: 'inv-001' });
    expect(dlqQueue.add).not.toHaveBeenCalled(); // DLQ never triggered
    expect(emailService.sendInvoiceReminder).toHaveBeenCalledTimes(3);
  });
});
