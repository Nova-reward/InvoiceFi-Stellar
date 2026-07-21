import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ComplianceService } from './compliance.service';

@Injectable()
export class ComplianceScheduler {
  private readonly logger = new Logger(ComplianceScheduler.name);

  constructor(private readonly complianceService: ComplianceService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runRetentionCleanup() {
    this.logger.log('Starting scheduled compliance retention cleanup...');

    try {
      await this.complianceService.cleanupExpiredRecords();
    } catch (error) {
      this.logger.error('Compliance retention cleanup failed.', error instanceof Error ? error.stack : error);
    }
  }
}
