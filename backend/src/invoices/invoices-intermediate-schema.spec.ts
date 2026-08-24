/**
 * @file invoices-intermediate-schema.spec.ts
 *
 * Validates that InvoicesService and InvoiceDto are compatible with the
 * INTERMEDIATE schema that exists after migration 1 (expand part 1) but
 * before migration 3 (contract) – i.e. when both "investor" AND "funder"
 * columns are present simultaneously.
 *
 * This test does NOT hit a real database; it uses jest mocks so it can run in
 * CI without a Postgres instance.  The companion harness script
 * (scripts/test-expand-contract-harness.sh) runs these tests while a real
 * Postgres container is at the intermediate schema checkpoint.
 *
 * Acceptance criterion:
 *   "Application (backend unit tests) passes against the intermediate schema
 *    (after migration 1, before migration 3)"
 */

import { InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceDto, InvoicesService } from './invoices.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a mock Prisma record that mirrors the INTERMEDIATE schema:
 * both "investor" (old) and "funder" (new) columns are present.
 */
function buildIntermediateRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    onchainId: BigInt(42),
    status: InvoiceStatus.PENDING,
    faceValue: BigInt(100_000),
    farmer: 'FARMER_ADDR',
    // Old column – still present in intermediate schema
    investor: 'INVESTOR_ADDR',
    // New column – added by migration 1; may be null before backfill
    funder: null,
    discountPercentage: null,
    settledLedger: null,
    settledAt: null,
    createdAt: new Date('2026-07-23T12:00:00Z'),
    updatedAt: new Date('2026-07-23T12:00:00Z'),
    ...overrides,
  };
}

function buildPrismaWithRows(rows: ReturnType<typeof buildIntermediateRow>[]) {
  return {
    invoice: {
      findMany: jest.fn().mockResolvedValue(rows),
      findUnique: jest.fn().mockResolvedValue(rows[0] ?? null),
    },
  } as unknown as PrismaService;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InvoicesService – intermediate schema compatibility', () => {
  // ── findAll ──────────────────────────────────────────────────────────────

  it('findAll: returns DTOs when only investor is populated (pre-backfill state)', async () => {
    const row = buildIntermediateRow({ investor: 'INVESTOR_ADDR', funder: null });
    const prisma = buildPrismaWithRows([row]);
    const service = new InvoicesService(prisma);

    const result: InvoiceDto[] = await service.findAll();

    expect(result).toHaveLength(1);
    // The DTO still exposes the investor field (old code path – both work)
    expect(result[0].investor).toBe('INVESTOR_ADDR');
  });

  it('findAll: returns DTOs when both investor and funder are populated (dual-write state)', async () => {
    const row = buildIntermediateRow({
      investor: 'INVESTOR_ADDR',
      funder: 'FUNDER_ADDR',
    });
    const prisma = buildPrismaWithRows([row]);
    const service = new InvoicesService(prisma);

    const result = await service.findAll();

    expect(result).toHaveLength(1);
    expect(result[0].investor).toBe('INVESTOR_ADDR');
  });

  it('findAll: handles NULL investor (row created without funding)', async () => {
    const row = buildIntermediateRow({ investor: null, funder: null });
    const prisma = buildPrismaWithRows([row]);
    const service = new InvoicesService(prisma);

    const result = await service.findAll();

    expect(result[0].investor).toBeNull();
  });

  it('findAll: serialises BigInt fields to strings', async () => {
    const row = buildIntermediateRow({
      onchainId: BigInt(9007199254740993), // beyond Number.MAX_SAFE_INTEGER
      faceValue: BigInt(999_999_999_999),
    });
    const prisma = buildPrismaWithRows([row]);
    const service = new InvoicesService(prisma);

    const [dto] = await service.findAll();

    expect(dto.onchainId).toBe('9007199254740993');
    expect(dto.faceValue).toBe('999999999999');
  });

  // ── findOne ──────────────────────────────────────────────────────────────

  it('findOne: returns null when invoice is not found', async () => {
    const prisma = {
      invoice: {
        findMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaService;
    const service = new InvoicesService(prisma);

    const result = await service.findOne('999');

    expect(result).toBeNull();
  });

  it('findOne: resolves by onchainId as BigInt', async () => {
    const row = buildIntermediateRow({ onchainId: BigInt(77) });
    const prisma = buildPrismaWithRows([row]);
    const service = new InvoicesService(prisma);

    await service.findOne('77');

    expect(prisma.invoice.findUnique).toHaveBeenCalledWith({
      where: { onchainId: BigInt(77) },
    });
  });

  // ── byInvestor (old code path – must work throughout intermediate phase) --

  it('byInvestor: queries by investor field and returns matching rows', async () => {
    const row = buildIntermediateRow({ investor: 'INVESTOR_X' });
    const prisma = buildPrismaWithRows([row]);
    const service = new InvoicesService(prisma);

    const result = await service.byInvestor('INVESTOR_X');

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { investor: 'INVESTOR_X' } }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].investor).toBe('INVESTOR_X');
  });

  it('byInvestor: returns empty array when no rows match', async () => {
    const prisma = {
      invoice: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
      },
    } as unknown as PrismaService;
    const service = new InvoicesService(prisma);

    const result = await service.byInvestor('GHOST_INVESTOR');

    expect(result).toEqual([]);
  });

  // ── byFarmer ------------------------------------------------------------------

  it('byFarmer: returns invoices for a specific farmer', async () => {
    const row = buildIntermediateRow({ farmer: 'FARMER_ADDR' });
    const prisma = buildPrismaWithRows([row]);
    const service = new InvoicesService(prisma);

    const result = await service.byFarmer('FARMER_ADDR');

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { farmer: 'FARMER_ADDR' } }),
    );
    expect(result[0].farmer).toBe('FARMER_ADDR');
  });

  // ── DTO shape ─────────────────────────────────────────────────────────────

  it('DTO: settledAt is ISO string when present, null otherwise', async () => {
    const settledDate = new Date('2026-07-24T10:00:00Z');
    const rowSettled = buildIntermediateRow({
      status: InvoiceStatus.REPAID,
      settledAt: settledDate,
      settledLedger: 100,
    });
    const rowUnsettled = buildIntermediateRow({ settledAt: null, settledLedger: null });

    const prisma = buildPrismaWithRows([rowSettled, rowUnsettled]);
    const service = new InvoicesService(prisma);

    const [settled, unsettled] = await service.findAll();

    expect(settled.settledAt).toBe(settledDate.toISOString());
    expect(unsettled.settledAt).toBeNull();
  });

  it('DTO: createdAt and updatedAt are ISO strings', async () => {
    const row = buildIntermediateRow({
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-07-01T12:00:00Z'),
    });
    const prisma = buildPrismaWithRows([row]);
    const service = new InvoicesService(prisma);

    const [dto] = await service.findAll();

    expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(dto.updatedAt).toBe('2026-07-01T12:00:00.000Z');
  });
});
