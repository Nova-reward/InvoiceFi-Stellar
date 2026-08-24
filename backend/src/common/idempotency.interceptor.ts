import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { RedisService, IdempotencyRecord } from './redis.service';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);
  private readonly TTL_SECONDS = 24 * 60 * 60; // 24 hours

  constructor(private readonly redisService: RedisService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Only apply to POST methods with Idempotency-Key header
    if (request.method !== 'POST') {
      return next.handle();
    }

    const idempotencyKey = request.headers['idempotency-key'];
    if (!idempotencyKey) {
      throw new BadRequestException(
        'Idempotency-Key header is required for this endpoint'
      );
    }

    // Validate key format (UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(idempotencyKey)) {
      throw new BadRequestException(
        'Idempotency-Key must be a valid UUID'
      );
    }

    // Get user ID from request
    const userId = request.user?.userId || request.user?.sub || 'anonymous';
    const cacheKey = this.getCacheKey(idempotencyKey, userId);

    // Check if this key already exists
    const cachedRecord = await this.redisService.get<IdempotencyRecord>(cacheKey);

    if (cachedRecord) {
      // Verify the cached record belongs to the same user
      if (cachedRecord.userId !== userId) {
        throw new ForbiddenException(
          'Idempotency key belongs to a different user'
        );
      }

      this.logger.debug(
        `Idempotency cache hit for key ${idempotencyKey} (user ${userId})`
      );

      // Return cached response
      response.status(cachedRecord.statusCode);
      return of(cachedRecord.response);
    }

    // Execute the request
    return next.handle().pipe(
      tap(async (data) => {
        // Cache the response after successful execution
        const record: IdempotencyRecord = {
          response: data,
          statusCode: response.statusCode,
          userId,
          createdAt: Date.now(),
        };

        const setResult = await this.redisService.setIfNotExists(
          cacheKey,
          record,
          this.TTL_SECONDS
        );

        if (!setResult) {
          // Another request beat us to it - this shouldn't happen
          this.logger.warn(
            `Idempotency key ${idempotencyKey} was set concurrently`
          );
        } else {
          this.logger.debug(
            `Idempotency cache set for key ${idempotencyKey} (user ${userId})`
          );
        }
      }),
      catchError(async (error) => {
        // If the request fails, don't cache the error response
        // But we should log it
        this.logger.warn(
          `Idempotency request failed for key ${idempotencyKey}: ${error.message}`
        );
        throw error;
      }),
    );
  }

  private getCacheKey(idempotencyKey: string, userId: string): string {
    return `idempotency:${userId}:${idempotencyKey}`;
  }
}
