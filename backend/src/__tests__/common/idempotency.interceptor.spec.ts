import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { of } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { IdempotencyInterceptor } from '../../common/idempotency.interceptor';
import { RedisService } from '../../common/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import * as crypto from 'crypto';

// Mock PrismaService to avoid requiring the generated Prisma client
jest.mock('../../prisma/prisma.service', () => ({
  PrismaService: jest.fn().mockImplementation(() => ({
    idempotencyKey: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
  })),
}));

/** Helper: await the async intercept, then resolve the returned Observable. */
async function interceptAndResolve(
  interceptor: IdempotencyInterceptor,
  context: ExecutionContext,
  next: { handle: jest.Mock },
): Promise<any> {
  const observable = await interceptor.intercept(context, next as any);
  return firstValueFrom(observable);
}

describe('IdempotencyInterceptor', () => {
  let interceptor: IdempotencyInterceptor;
  let redisService: RedisService;
  let mockContext: ExecutionContext;
  let mockRequest: any;
  let mockResponse: any;

  const mockUserId = 'user-123';
  const mockIdempotencyKey = '123e4567-e89b-12d3-a456-426614174000';
  const mockBody = { amount: 5000, currency: 'USDC' };

  const mockPrismaIdempotencyKey = {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  };

  function bodyHash(body: unknown): string {
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(body ?? {}))
      .digest('hex');
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyInterceptor,
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(),
            setIfNotExists: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            idempotencyKey: mockPrismaIdempotencyKey,
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(24),
          },
        },
      ],
    }).compile();

    interceptor = module.get<IdempotencyInterceptor>(IdempotencyInterceptor);
    redisService = module.get<RedisService>(RedisService);

    mockRequest = {
      method: 'POST',
      path: '/invoices',
      headers: { 'idempotency-key': mockIdempotencyKey },
      user: { userId: mockUserId },
      body: mockBody,
    };

    mockResponse = {
      statusCode: 201,
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
    };

    mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    } as any;

    jest.clearAllMocks();
  });

  // ─── Scenario 1: First call — key is new ───────────────────────────────────

  describe('Scenario 1: First call with new key', () => {
    it('should execute the request and store in DB + Redis', async () => {
      const mockResponseData = { success: true, id: '42' };
      const nextHandler = {
        handle: jest.fn().mockReturnValue(of(mockResponseData)),
      };

      jest.spyOn(redisService, 'get').mockResolvedValue(null);
      mockPrismaIdempotencyKey.findUnique.mockResolvedValue(null);
      mockPrismaIdempotencyKey.create.mockResolvedValue({ id: 'db-record-1' });
      mockPrismaIdempotencyKey.update.mockResolvedValue({});
      jest.spyOn(redisService, 'setIfNotExists').mockResolvedValue(true);

      const result = await interceptAndResolve(interceptor, mockContext, nextHandler);

      expect(result).toEqual(mockResponseData);
      expect(mockPrismaIdempotencyKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            key: mockIdempotencyKey,
            userId: mockUserId,
          }),
        }),
      );
      expect(mockPrismaIdempotencyKey.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lockedAt: null }),
        }),
      );
    });
  });

  // ─── Scenario 2: Identical retry — Redis cache hit ─────────────────────────

  describe('Scenario 2: Identical retry (Redis cache hit)', () => {
    it('should return cached response without re-executing handler', async () => {
      const cachedRecord = {
        response: { success: true, id: '42' },
        statusCode: 201,
        userId: mockUserId,
        bodyHash: bodyHash(mockBody),
        createdAt: Date.now(),
      };

      const nextHandler = { handle: jest.fn() };
      jest.spyOn(redisService, 'get').mockResolvedValue(cachedRecord);

      const result = await interceptAndResolve(interceptor, mockContext, nextHandler);

      expect(result).toEqual(cachedRecord.response);
      expect(nextHandler.handle).not.toHaveBeenCalled();
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'X-Idempotent-Replayed',
        'true',
      );
    });
  });

  // ─── Scenario 3: Same key, different body — 409 Conflict ──────────────────

  describe('Scenario 3: Different body with same key (409 Conflict)', () => {
    it('should throw ConflictException when body hash differs (Redis path)', async () => {
      const cachedRecord = {
        response: { success: true },
        statusCode: 201,
        userId: mockUserId,
        bodyHash: 'different-hash-abc123',
        createdAt: Date.now(),
      };

      jest.spyOn(redisService, 'get').mockResolvedValue(cachedRecord);

      await expect(
        interceptor.intercept(mockContext, { handle: jest.fn() } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException via DB path when body hash differs', async () => {
      const existingRecord = {
        id: 'db-record-1',
        key: mockIdempotencyKey,
        userId: mockUserId,
        bodyHash: 'completely-different-hash',
        lockedAt: null,
        responseBody: { success: true },
        statusCode: 201,
      };

      jest.spyOn(redisService, 'get').mockResolvedValue(null);
      mockPrismaIdempotencyKey.findUnique.mockResolvedValue(existingRecord);

      await expect(
        interceptor.intercept(mockContext, { handle: jest.fn() } as any),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── Scenario 4: Expired key — cleaned-up, treated as first call ───────────

  describe('Scenario 4: Expired key (no cache, no DB record)', () => {
    it('should treat expired (cleaned-up) key as a fresh first call', async () => {
      const mockResponseData = { success: true, id: '99' };
      const nextHandler = {
        handle: jest.fn().mockReturnValue(of(mockResponseData)),
      };

      jest.spyOn(redisService, 'get').mockResolvedValue(null);
      mockPrismaIdempotencyKey.findUnique.mockResolvedValue(null); // expired = deleted
      mockPrismaIdempotencyKey.create.mockResolvedValue({ id: 'db-record-new' });
      mockPrismaIdempotencyKey.update.mockResolvedValue({});
      jest.spyOn(redisService, 'setIfNotExists').mockResolvedValue(true);

      const result = await interceptAndResolve(interceptor, mockContext, nextHandler);

      expect(result).toEqual(mockResponseData);
      expect(mockPrismaIdempotencyKey.create).toHaveBeenCalled();
    });
  });

  // ─── Scenario 5: Missing Idempotency-Key header ────────────────────────────

  describe('Scenario 5: Missing Idempotency-Key header', () => {
    it('should throw BadRequestException when header is absent', async () => {
      mockRequest.headers = {};

      await expect(
        interceptor.intercept(mockContext, { handle: jest.fn() } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── Scenario 6: Invalid UUID format ──────────────────────────────────────

  describe('Scenario 6: Invalid UUID format', () => {
    it('should throw BadRequestException when key is not a valid UUID', async () => {
      mockRequest.headers['idempotency-key'] = 'not-a-uuid';

      await expect(
        interceptor.intercept(mockContext, { handle: jest.fn() } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── Scenario 7: GET requests bypass idempotency ─────────────────────────

  describe('Scenario 7: GET requests should bypass idempotency', () => {
    it('should bypass interceptor for GET requests', async () => {
      mockRequest.method = 'GET';
      const nextHandler = {
        handle: jest.fn().mockReturnValue(of({ data: 'test' })),
      };

      const result = await interceptAndResolve(interceptor, mockContext, nextHandler);

      expect(result).toEqual({ data: 'test' });
      expect(redisService.get).not.toHaveBeenCalled();
    });
  });

  // ─── Scenario 8: Concurrent duplicate — DB row locked ─────────────────────

  describe('Scenario 8: Concurrent duplicate request (DB lock race)', () => {
    it('should throw ConflictException when DB row is already locked (in-flight)', async () => {
      const lockedRecord = {
        id: 'db-record-1',
        key: mockIdempotencyKey,
        userId: mockUserId,
        bodyHash: bodyHash(mockBody),
        lockedAt: new Date(),
        lockOwner: 'other-host:1234',
        responseBody: {},
        statusCode: 0,
      };

      jest.spyOn(redisService, 'get').mockResolvedValue(null);
      mockPrismaIdempotencyKey.findUnique.mockResolvedValue(lockedRecord);

      await expect(
        interceptor.intercept(mockContext, { handle: jest.fn() } as any),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── Scenario 9: DB cache hit — Redis cold ────────────────────────────────

  describe('Scenario 9: DB idempotency hit (Redis cold, completed DB record)', () => {
    it('should return DB-cached response when Redis has no entry', async () => {
      const hash = bodyHash(mockBody);

      const dbRecord = {
        id: 'db-record-1',
        key: mockIdempotencyKey,
        userId: mockUserId,
        bodyHash: hash,
        lockedAt: null,
        responseBody: { success: true, id: '42' },
        statusCode: 201,
      };

      jest.spyOn(redisService, 'get').mockResolvedValue(null);
      mockPrismaIdempotencyKey.findUnique.mockResolvedValue(dbRecord);

      const result = await interceptAndResolve(
        interceptor,
        mockContext,
        { handle: jest.fn() },
      );

      expect(result).toEqual(dbRecord.responseBody);
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'X-Idempotent-Replayed',
        'true',
      );
    });
  });

  // ─── Scenario 10: DB unique-constraint race (P2002) ───────────────────────

  describe('Scenario 10: DB unique-constraint race (P2002)', () => {
    it('should throw ConflictException when DB create fails with P2002', async () => {
      const p2002Error = Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
      });

      jest.spyOn(redisService, 'get').mockResolvedValue(null);
      mockPrismaIdempotencyKey.findUnique.mockResolvedValue(null);
      mockPrismaIdempotencyKey.create.mockRejectedValue(p2002Error);

      await expect(
        interceptor.intercept(mockContext, { handle: jest.fn() } as any),
      ).rejects.toThrow(ConflictException);
    });
  });
});
