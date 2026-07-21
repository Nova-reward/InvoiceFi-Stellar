import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ExportFormat,
  ExportJobStatus,
  ExportType,
  Invoice,
  InvoiceStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ComplianceConfig } from './compliance.config';
import { ComplianceService } from './compliance.service';
import { ExportSigningService } from './export-signing.service';
import { Principal } from './principal';
import { verifyContent } from './signing';

const ADMIN: Principal = { userId: '1', walletAddress: 'GADMIN', role: 'admin' };
const USER: Principal = {
  userId: '2',
  walletAddress: 'GUSER',
  role: 'investor',
};

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 1,
    onchainId: 1n,
    status: InvoiceStatus.FUNDED,
    faceValue: 10000000n,
    farmer: 'GFARMER',
    investor: 'GUSER',
    settledLedger: null,
    settledAt: null,
    fundedAmount: null,
    repaidAmount: null,
    assetCode: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

interface Mocks {
  invoice: { findMany: jest.Mock };
  exportJob: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
}

function setup(): {
  service: ComplianceService;
  prisma: Mocks;
  signing: ExportSigningService;
} {
  const prisma: Mocks = {
    invoice: { findMany: jest.fn() },
    exportJob: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  };
  const stubConfig = { get: () => undefined } as unknown as ConfigService;
  const config = new ComplianceConfig(stubConfig);
  const signing = new ExportSigningService(stubConfig);
  signing.onModuleInit();
  const service = new ComplianceService(
    prisma as unknown as PrismaService,
    config,
    signing,
  );
  return { service, prisma, signing };
}

describe('ComplianceService — access scoping', () => {
  it('forbids a non-admin from exporting another subject', async () => {
    const { service } = setup();
    await expect(
      service.exportTransactionsInline(USER, { subject: 'GOTHER' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('scopes a non-admin export to their own wallet', async () => {
    const { service, prisma } = setup();
    prisma.invoice.findMany.mockResolvedValue([]);

    await service.exportTransactionsInline(USER, { threshold: '0' });

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ farmer: 'GUSER' }, { investor: 'GUSER' }] },
      }),
    );
  });

  it('lets an admin export all data (no subject filter)', async () => {
    const { service, prisma } = setup();
    prisma.invoice.findMany.mockResolvedValue([]);

    await service.exportTransactionsInline(ADMIN, { threshold: '0' });

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('requires admins to name a subject for investor reports', async () => {
    const { service } = setup();
    await expect(
      service.exportInvestorReportInline(ADMIN, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an invalid format', async () => {
    const { service } = setup();
    await expect(
      service.exportTransactionsInline(ADMIN, { format: 'xml' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ComplianceService — inline exports', () => {
  it('produces a signed JSON document that verifies against the content', async () => {
    const { service, prisma, signing } = setup();
    prisma.invoice.findMany.mockResolvedValue([makeInvoice()]);

    const result = await service.exportTransactionsInline(ADMIN, {
      threshold: '0',
    });

    expect(result.contentType).toBe('application/json');
    const parsed = JSON.parse(result.content);
    expect(parsed.exportType).toBe('TRANSACTIONS');
    expect(parsed.recordCount).toBe(1);
    expect(result.recordCount).toBe(1);
    expect(
      verifyContent(
        result.integrity.signerPublicKey,
        result.content,
        result.integrity,
      ),
    ).toBe(true);
    expect(result.integrity.signerPublicKey).toBe(signing.signerPublicKey);
  });

  it('produces CSV with the FATF header row', async () => {
    const { service, prisma } = setup();
    prisma.invoice.findMany.mockResolvedValue([makeInvoice()]);

    const result = await service.exportTransactionsInline(ADMIN, {
      format: 'csv',
      threshold: '0',
    });

    expect(result.contentType).toBe('text/csv');
    expect(result.content.split('\r\n')[0]).toContain('transactionRef');
    expect(result.filename.endsWith('.csv')).toBe(true);
  });
});

describe('ComplianceService — async jobs', () => {
  it('enqueues a PENDING job and returns a summary', async () => {
    const { service, prisma } = setup();
    prisma.exportJob.create.mockResolvedValue({
      id: 'job-1',
      type: ExportType.TRANSACTIONS,
      format: ExportFormat.JSON,
      status: ExportJobStatus.PENDING,
      requestedBy: 'GADMIN',
      subject: null,
      recordCount: null,
      byteLength: null,
      contentType: null,
      sha256: null,
      signature: null,
      signerPublicKey: null,
      error: null,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
    });
    // Background processJob will look up the job; return null so it no-ops.
    prisma.exportJob.findUnique.mockResolvedValue(null);

    const summary = await service.enqueueTransactionsExport(ADMIN, {
      threshold: '0',
    });

    expect(prisma.exportJob.create).toHaveBeenCalled();
    expect(summary.status).toBe(ExportJobStatus.PENDING);
    expect(summary.downloadUrl).toBeNull();
  });

  it('processes a pending job to COMPLETED with an integrity proof', async () => {
    const { service, prisma } = setup();
    prisma.exportJob.findUnique.mockResolvedValue({
      id: 'job-2',
      type: ExportType.TRANSACTIONS,
      format: ExportFormat.JSON,
      status: ExportJobStatus.PENDING,
      subject: null,
      thresholdMinorUnits: '0',
      rangeStart: null,
      rangeEnd: null,
    });
    prisma.invoice.findMany.mockResolvedValue([makeInvoice()]);
    prisma.exportJob.update.mockResolvedValue({});

    await service.processJob('job-2');

    expect(prisma.exportJob.update).toHaveBeenCalledTimes(2);
    const completion = prisma.exportJob.update.mock.calls[1][0];
    expect(completion.data.status).toBe(ExportJobStatus.COMPLETED);
    expect(completion.data.sha256).toEqual(expect.any(String));
    expect(completion.data.signature).toEqual(expect.any(String));
    expect(completion.data.recordCount).toBe(1);
  });

  it('marks a job FAILED when building throws', async () => {
    const { service, prisma } = setup();
    prisma.exportJob.findUnique.mockResolvedValue({
      id: 'job-3',
      type: ExportType.TRANSACTIONS,
      format: ExportFormat.JSON,
      subject: null,
      thresholdMinorUnits: '0',
      status: ExportJobStatus.PENDING,
      rangeStart: null,
      rangeEnd: null,
    });
    prisma.invoice.findMany.mockRejectedValue(new Error('db down'));
    prisma.exportJob.update.mockResolvedValue({});

    await service.processJob('job-3');

    const completion = prisma.exportJob.update.mock.calls[1][0];
    expect(completion.data.status).toBe(ExportJobStatus.FAILED);
    expect(completion.data.error).toBe('db down');
  });
});

describe('ComplianceService — job access & download', () => {
  it('hides another user’s job from a non-admin (404)', async () => {
    const { service, prisma } = setup();
    prisma.exportJob.findUnique.mockResolvedValue({
      id: 'j',
      requestedBy: 'GSOMEONE',
      status: ExportJobStatus.COMPLETED,
    });
    await expect(service.getJob(USER, 'j')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses to download a job that is not COMPLETED', async () => {
    const { service, prisma } = setup();
    prisma.exportJob.findUnique.mockResolvedValue({
      id: 'j',
      requestedBy: 'GUSER',
      status: ExportJobStatus.PROCESSING,
      content: null,
    });
    await expect(service.downloadJob(USER, 'j')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('returns content and integrity for a completed job', async () => {
    const { service, prisma } = setup();
    prisma.exportJob.findUnique.mockResolvedValue({
      id: 'j',
      type: ExportType.TRANSACTIONS,
      format: ExportFormat.JSON,
      requestedBy: 'GUSER',
      subject: 'GUSER',
      status: ExportJobStatus.COMPLETED,
      content: '{"records":[]}',
      contentType: 'application/json',
      recordCount: 0,
      byteLength: 14,
      sha256: 'abc',
      signature: 'sig',
      signerPublicKey: 'GKEY',
    });

    const result = await service.downloadJob(USER, 'j');
    expect(result.content).toBe('{"records":[]}');
    expect(result.integrity.sha256).toBe('abc');
    expect(result.filename.endsWith('.json')).toBe(true);
  });
});
