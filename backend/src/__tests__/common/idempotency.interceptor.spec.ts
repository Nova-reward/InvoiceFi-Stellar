import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, BadRequestException, ForbiddenException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { IdempotencyInterceptor } from '../../../common/idempotency.interceptor';
import { RedisService } from '../../../common/redis.service';

describe('IdempotencyInterceptor', () => {
  let interceptor: IdempotencyInterceptor;
  let redisService: RedisService;
  let mockContext: ExecutionContext;
  let mockRequest: any;
  let mockResponse: any;

  const mockUserId = 'user-123';
  const mockIdempotencyKey = '123e4567-e89b-12d3-a456-426614174000';

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
      ],
    }).compile();

    interceptor = module.get<IdempotencyInterceptor>(IdempotencyInterceptor);
    redisService = module.get<RedisService>(RedisService);

    // Setup request/response mocks
    mockRequest = {
      method: 'POST',
      headers: {
        'idempotency-key': mockIdempotencyKey,
      },
      user: { userId: mockUserId },
    };

    mockResponse = {
      statusCode: 200,
      status: jest.fn().mockReturnThis(),
    };

    mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    } as any;

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('Scenario 1: First call with new key', () => {
    it('should execute the request and cache the response', async () => {
      const mockResponseData = { success: true, txHash: '0x123' };
      const nextHandler = {
        handle: jest.fn().mockReturnValue(of(mockResponseData)),
      };

      jest.spyOn(redisService, 'get').mockResolvedValue(null);
      jest.spyOn(redisService, 'setIfNotExists').mockResolvedValue(true);

      const result = await interceptor
        .intercept(mockContext, nextHandler)
        .toPromise();

      expect(result).toEqual(mockResponseData);
      expect(redisService.get).toHaveBeenCalledWith(
        `idempotency:${mockUserId}:${mockIdempotencyKey}`
      );
      expect(redisService.setIfNotExists).toHaveBeenCalled();
    });
  });

  describe('Scenario 2: Repeat call with same key', () => {
    it('should return cached response without re-executing', async () => {
      const cachedResponse = {
        response: { success: true, txHash: '0x123' },
        statusCode: 200,
        userId: mockUserId,
        createdAt: Date.now(),
      };

      const nextHandler = {
        handle: jest.fn(),
      };

      jest.spyOn(redisService, 'get').mockResolvedValue(cachedResponse);

      const result = await interceptor
        .intercept(mockContext, nextHandler)
        .toPromise();

      expect(result).toEqual(cachedResponse.response);
      expect(nextHandler.handle).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(200);
    });
  });

  describe('Scenario 3: Key collision across different users', () => {
    it('should return 403 when key belongs to different user', async () => {
      const cachedResponse = {
        response: { success: true },
        statusCode: 200,
        userId: 'different-user', // Different user!
        createdAt: Date.now(),
      };

      const nextHandler = {
        handle: jest.fn(),
      };

      jest.spyOn(redisService, 'get').mockResolvedValue(cachedResponse);

      await expect(
        interceptor.intercept(mockContext, nextHandler).toPromise()
      ).rejects.toThrow(ForbiddenException);

      expect(nextHandler.handle).not.toHaveBeenCalled();
    });
  });

  describe('Scenario 4: Missing Idempotency-Key header', () => {
    it('should throw 400 when header is missing', async () => {
      mockRequest.headers = {};

      const nextHandler = {
        handle: jest.fn(),
      };

      await expect(
        interceptor.intercept(mockContext, nextHandler).toPromise()
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Scenario 5: Invalid UUID format', () => {
    it('should throw 400 when key is not a valid UUID', async () => {
      mockRequest.headers['idempotency-key'] = 'invalid-key';

      const nextHandler = {
        handle: jest.fn(),
      };

      await expect(
        interceptor.intercept(mockContext, nextHandler).toPromise()
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Scenario 6: Failed request should not be cached', () => {
    it('should not cache failed requests', async () => {
      const nextHandler = {
        handle: jest.fn().mockReturnValue(throwError(() => new Error('Network error'))),
      };

      jest.spyOn(redisService, 'get').mockResolvedValue(null);

      await expect(
        interceptor.intercept(mockContext, nextHandler).toPromise()
      ).rejects.toThrow('Network error');

      // The response should not be cached
      expect(redisService.setIfNotExists).not.toHaveBeenCalled();
    });
  });

  describe('Scenario 7: GET requests should bypass idempotency', () => {
    it('should bypass interceptor for GET requests', async () => {
      mockRequest.method = 'GET';

      const nextHandler = {
        handle: jest.fn().mockReturnValue(of({ data: 'test' })),
      };

      const result = await interceptor
        .intercept(mockContext, nextHandler)
        .toPromise();

      expect(result).toEqual({ data: 'test' });
      expect(redisService.get).not.toHaveBeenCalled();
    });
  });
});
