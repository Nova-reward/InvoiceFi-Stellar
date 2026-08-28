import { Test, TestingModule } from '@nestjs/testing';
import { IdempotencyCleanupService } from './idempotency-cleanup.service';
import { PrismaService } from '../prisma/prisma.service';

// Mock the PrismaService module to avoid requiring the generated Prisma client
jest.mock('../prisma/prisma.service', () => ({
  PrismaService: jest.fn().mockImplementation(() => ({
    idempotencyKey: {
      deleteMany: jest.fn(),
    },
  })),
}));

describe('IdempotencyCleanupService', () => {
  let service: IdempotencyCleanupService;
  let prismaService: PrismaService;

  const mockPrismaIdempotencyKey = {
    deleteMany: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyCleanupService,
        {
          provide: PrismaService,
          useValue: { idempotencyKey: mockPrismaIdempotencyKey },
        },
      ],
    }).compile();

    service = module.get<IdempotencyCleanupService>(IdempotencyCleanupService);
    prismaService = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  describe('deleteExpiredKeys', () => {
    it('should delete keys where expiresAt is in the past', async () => {
      mockPrismaIdempotencyKey.deleteMany.mockResolvedValue({ count: 5 });

      const result = await service.deleteExpiredKeys();

      expect(result).toBe(5);
      expect(mockPrismaIdempotencyKey.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      });
    });

    it('should return 0 when no keys have expired', async () => {
      mockPrismaIdempotencyKey.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.deleteExpiredKeys();

      expect(result).toBe(0);
    });
  });

  describe('releaseStaleLocks', () => {
    it('should delete rows locked more than 5 minutes ago', async () => {
      mockPrismaIdempotencyKey.deleteMany.mockResolvedValue({ count: 2 });

      const result = await service.releaseStaleLocks();

      expect(result).toBe(2);
      expect(mockPrismaIdempotencyKey.deleteMany).toHaveBeenCalledWith({
        where: {
          lockedAt: { lt: expect.any(Date), not: null },
        },
      });
    });

    it('should return 0 when no stale locks exist', async () => {
      mockPrismaIdempotencyKey.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.releaseStaleLocks();

      expect(result).toBe(0);
    });
  });
});
