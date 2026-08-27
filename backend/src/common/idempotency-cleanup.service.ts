import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Periodically deletes expired IdempotencyKey rows from the database.
 *
 * Runs every hour by default. Stale locks (crash-orphaned rows where
 * `lockedAt` is older than 2× the TTL) are also reclaimed so they
 * cannot permanently block retries.
 */
@Injectable()
export class IdempotencyCleanupService {
  private readonly logger = new Logger(IdempotencyCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Delete idempotency keys whose TTL has elapsed.
   * Scheduled hourly in production; exposed as a public method so tests
   * and admin tooling can trigger it directly.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async deleteExpiredKeys(): Promise<number> {
    const now = new Date();
    const result = await this.prisma.idempotencyKey.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    if (result.count > 0) {
      this.logger.log(`Cleaned up ${result.count} expired idempotency key(s)`);
    }
    return result.count;
  }

  /**
   * Release locks held by crashed workers.
   *
   * A lock is considered stale when `lockedAt` is older than
   * `IDEMPOTENCY_STALE_LOCK_MINUTES` (default: 5 minutes). The row is
   * deleted rather than unlocked so the client can safely retry with the
   * same key (a new row will be created).
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async releaseStaleLocks(): Promise<number> {
    const staleCutoff = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes
    const result = await this.prisma.idempotencyKey.deleteMany({
      where: {
        lockedAt: { lt: staleCutoff, not: null },
      },
    });
    if (result.count > 0) {
      this.logger.warn(
        `Released ${result.count} stale idempotency lock(s) (likely crashed workers)`,
      );
    }
    return result.count;
  }
}
