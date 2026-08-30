import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IdempotencyCleanupService } from './idempotency-cleanup.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisService } from './redis.service';

@Module({
  imports: [ConfigModule, ScheduleModule.forRoot(), PrismaModule],
  providers: [IdempotencyInterceptor, IdempotencyCleanupService, RedisService],
  exports: [IdempotencyInterceptor, IdempotencyCleanupService],
})
export class IdempotencyModule {}
