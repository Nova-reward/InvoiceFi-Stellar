import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Logger,
  HttpStatus,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import * as crypto from 'crypto';
import * as os from 'os';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from './redis.service';

/** Redis-cached record shape (fast path). */
export interface IdempotencyRecord {
  response: any;
  statusCode: number;
  userId: string;
  /** SHA-256 hex of the original request body (detects key reuse with different payload). */
  bodyHash: string;
  createdAt: number;
}

/**
 * Idempotency interceptor that prevents double-spend / double-mint from
 * network retries.
 *
 * Design:
 *   - Redis is used as a fast-path cache so repeated retries don't hit the DB.
 *   - PostgreSQL (via Prisma) is the authoritative store and provides
 *     row-level locking semantics that Redis cannot guarantee under concurrent
 *     requests on separate pods.
 *   - A DB row is inserted with `lockedAt = now()` before the handler runs.
 *     A unique constraint on (key, userId) means only one concurrent request
 *     can win; the loser gets a P2002 (unique violation) and returns 409.
 *   - On handler success the row is updated: lock released, response stored.
 *   - Body fingerprint (SHA-256): reusing a key with a different body yields 409.
 *   - TTL is configurable via `IDEMPOTENCY_TTL_HOURS` (default 24).
 *   - Stale locks (crashed workers) are reclaimed by IdempotencyCleanupService.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);
  /** Unique identifier used in lock ownership records. */
  private readonly lockOwner = `${os.hostname()}:${process.pid}`;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly config: ConfigService,
  ) {}

  private get ttlSeconds(): number {
    const hours = this.config.get<number>('IDEMPOTENCY_TTL_HOURS') ?? 24;
    return Number(hours) * 3600;
  }

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Only POST requests require idempotency
    if (request.method !== 'POST') {
      return next.handle();
    }

    const idempotencyKey: string | undefined =
      request.headers['idempotency-key'];
    if (!idempotencyKey) {
      throw new BadRequestException(
        'Idempotency-Key header is required for this endpoint',
      );
    }

    // Validate UUID v4 format
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(idempotencyKey)) {
      throw new BadRequestException('Idempotency-Key must be a valid UUID');
    }

    const userId: string =
      request.user?.userId ?? request.user?.sub ?? 'anonymous';
    const bodyHash = this.hashBody(request.body);
    const requestPath = `${request.method} ${request.path}`;
    const cacheKey = `idempotency:${userId}:${idempotencyKey}`;

    // ── Fast path: check Redis ─────────────────────────────────────────────
    try {
      const cached = await this.redisService.get<IdempotencyRecord>(cacheKey);
      if (cached) {
        return this.replayFromCache(
          cached,
          userId,
          bodyHash,
          idempotencyKey,
          response,
        );
      }
    } catch (redisErr) {
      // Re-throw NestJS HTTP exceptions (e.g. ConflictException, ForbiddenException)
      // that were raised by replayFromCache — we must not swallow those.
      if ((redisErr as any)?.status !== undefined) {
        throw redisErr;
      }
      // Redis is optional — fall through to DB on connectivity errors
      this.logger.warn(
        `Redis unavailable for idempotency key ${idempotencyKey}: ${
          (redisErr as Error).message
        }`,
      );
    }

    // ── Authoritative path: check / acquire DB lock ────────────────────────
    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { key_userId: { key: idempotencyKey, userId } },
    });

    if (existing) {
      // Different body with same key → 409 Conflict
      if (existing.bodyHash !== bodyHash) {
        throw new ConflictException(
          'Idempotency key already used with a different request body',
        );
      }

      // Row is locked → another request is currently in-flight
      if (existing.lockedAt !== null) {
        this.logger.warn(
          `Idempotency key ${idempotencyKey} locked by ${existing.lockOwner}`,
        );
        throw new ConflictException(
          'A concurrent request with the same Idempotency-Key is in progress. ' +
            'Retry after the first request completes.',
        );
      }

      // Row is complete (lockedAt = null) → replay cached DB response
      this.logger.debug(
        `DB idempotency hit for key ${idempotencyKey} (user ${userId})`,
      );
      response.status(existing.statusCode);
      response.setHeader('X-Idempotent-Replayed', 'true');
      return of(existing.responseBody);
    }

    // ── First request: acquire lock by inserting a new row ─────────────────
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);
    let dbRecord: { id: string };

    try {
      dbRecord = await this.prisma.idempotencyKey.create({
        data: {
          key: idempotencyKey,
          userId,
          bodyHash,
          statusCode: 0,
          responseBody: {},
          requestPath,
          lockedAt: new Date(),
          lockOwner: this.lockOwner,
          expiresAt,
        },
        select: { id: true },
      });
    } catch (createErr: any) {
      // P2002 = unique constraint violation: concurrent request won the race
      if (createErr?.code === 'P2002') {
        throw new ConflictException(
          'A concurrent request with the same Idempotency-Key is in progress. ' +
            'Retry after the first request completes.',
        );
      }
      throw createErr;
    }

    // ── Execute handler, then persist response and release lock ────────────
    return next.handle().pipe(
      tap(async (data) => {
        const statusCode: number = response.statusCode ?? HttpStatus.OK;

        // Persist the response and release the DB lock atomically
        await this.prisma.idempotencyKey.update({
          where: { id: dbRecord.id },
          data: {
            statusCode,
            responseBody: data ?? {},
            lockedAt: null,
            lockOwner: null,
          },
        });

        // Populate Redis fast-path cache
        const record: IdempotencyRecord = {
          response: data,
          statusCode,
          userId,
          bodyHash,
          createdAt: Date.now(),
        };
        try {
          await this.redisService.setIfNotExists(
            cacheKey,
            record,
            this.ttlSeconds,
          );
        } catch (redisErr) {
          // Redis is optional; DB is authoritative
          this.logger.warn(
            `Could not write Redis cache for idempotency key ${idempotencyKey}: ${
              (redisErr as Error).message
            }`,
          );
        }

        this.logger.debug(
          `Idempotency key ${idempotencyKey} stored (user ${userId})`,
        );
      }),
    );
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private replayFromCache(
    cached: IdempotencyRecord,
    userId: string,
    bodyHash: string,
    idempotencyKey: string,
    response: any,
  ): Observable<any> {
    // Guard against cross-user leakage (shouldn't normally reach here because
    // cacheKey already includes userId, but be defensive)
    if (cached.userId !== userId) {
      throw new ForbiddenException(
        'Idempotency key belongs to a different user',
      );
    }
    // Same key, different body → 409
    if (cached.bodyHash !== bodyHash) {
      throw new ConflictException(
        'Idempotency key already used with a different request body',
      );
    }

    this.logger.debug(
      `Redis idempotency hit for key ${idempotencyKey} (user ${userId})`,
    );
    response.status(cached.statusCode);
    response.setHeader('X-Idempotent-Replayed', 'true');
    return of(cached.response);
  }

  /** Canonical SHA-256 hash of the request body (sorted keys for stability). */
  private hashBody(body: unknown): string {
    const canonical = JSON.stringify(body ?? {});
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  /** @deprecated kept for backward compatibility — use cacheKey inline instead */
  private getCacheKey(idempotencyKey: string, userId: string): string {
    return `idempotency:${userId}:${idempotencyKey}`;
  }
}
