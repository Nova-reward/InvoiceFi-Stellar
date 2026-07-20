import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { ComplianceScheduler } from './compliance.scheduler';

@Module({
  imports: [PrismaModule],
  controllers: [ComplianceController],
  providers: [ComplianceService, ComplianceScheduler],
  exports: [ComplianceService],
})
export class ComplianceModule {}
