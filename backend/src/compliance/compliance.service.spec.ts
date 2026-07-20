import { ComplianceService } from './compliance.service';

describe('ComplianceService', () => {
  let prisma: any;
  let service: ComplianceService;

  beforeEach(() => {
    prisma = {
      invoice: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
    } as any;

    service = new ComplianceService(prisma);
  });

  it('exports all personal data for the provided user in a machine-readable shape', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      {
        id: 1,
        onchainId: 12n,
        status: 'FUNDED',
        faceValue: 500n,
        farmer: 'GABC123',
        investor: 'GXYZ789',
        settledLedger: 55,
        settledAt: new Date('2026-01-01T00:00:00.000Z'),
        createdAt: new Date('2025-12-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    ] as any);

    const result = await service.exportPersonalData('GABC123');

    expect(prisma.invoice.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ farmer: 'GABC123' }, { investor: 'GABC123' }],
      },
    });
    expect(result.userId).toBe('GABC123');
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      id: 1,
      farmer: 'GABC123',
      investor: 'GXYZ789',
    });
  });

  it('pseudonymizes records for an erasure request while preserving on-chain linkage fields', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      {
        id: 1,
        onchainId: 12n,
        status: 'FUNDED',
        faceValue: 500n,
        farmer: 'GABC123',
        investor: 'GXYZ789',
        settledLedger: 55,
        settledAt: new Date('2026-01-01T00:00:00.000Z'),
        createdAt: new Date('2025-12-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    ] as any);

    prisma.invoice.updateMany.mockResolvedValue({ count: 1 } as any);

    const result = await service.requestErasure({ userId: 'GABC123', reason: 'right-to-erasure' });

    expect(prisma.invoice.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ farmer: 'GABC123' }, { investor: 'GABC123' }],
      },
    });
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({
      where: {
        id: 1,
      },
      data: {
        farmer: 'farmer-redacted-1',
      },
    });
    expect(result).toMatchObject({
      status: 'completed',
      userId: 'GABC123',
      pseudonymizedRecordCount: 1,
      reason: 'right-to-erasure',
    });
  });

  it('pseudonymizes invoice participant fields during scheduled retention cleanup', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      {
        id: 7,
        onchainId: 77n,
        status: 'FUNDED',
        faceValue: 350n,
        farmer: 'GOLDEN-ADDRESS',
        investor: 'INVESTOR-ADDRESS',
        settledLedger: 80,
        settledAt: new Date('2025-01-02T00:00:00.000Z'),
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-05T00:00:00.000Z'),
      },
    ] as any);

    prisma.invoice.updateMany.mockResolvedValue({ count: 1 } as any);

    const result = await service.cleanupExpiredRecords();

    expect(prisma.invoice.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { createdAt: { lte: expect.any(Date) } },
          { settledAt: { lte: expect.any(Date) } },
        ],
      },
    });
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        farmer: 'farmer-redacted-7',
        investor: 'investor-redacted-7',
      },
    });
    expect(result).toMatchObject({
      processedRecords: 1,
      retentionWindowDays: 365,
    });
  });
});
