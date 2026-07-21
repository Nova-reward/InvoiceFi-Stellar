import { Module } from '@nestjs/common';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { ComplianceConfig } from './compliance.config';
import { ExportSigningService } from './export-signing.service';

/**
 * Regulatory disclosure & export API (FATF Travel Rule, transaction history,
 * investor P&L reports) with access control and signed, audit-ready output.
 */
@Module({
  controllers: [ComplianceController],
  providers: [ComplianceService, ComplianceConfig, ExportSigningService],
  exports: [ComplianceService],
})
export class ComplianceModule {}
