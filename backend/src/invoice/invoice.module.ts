import { Module } from '@nestjs/common';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { RedisService } from '../common/redis.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [InvoiceController],
  providers: [InvoiceService, IdempotencyInterceptor, RedisService],
  exports: [InvoiceService],
})
export class InvoiceModule {}
