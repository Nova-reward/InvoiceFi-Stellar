import { Module } from '@nestjs/common';
import { OracleMonitorService } from './oracle-monitor.service';
import { OracleMonitorController } from './oracle-monitor.controller';
import { OracleAlertService } from './oracle-alert.service';
import { FallbackStrategyService } from './fallback-strategy.service';

@Module({
  controllers: [OracleMonitorController],
  providers: [OracleMonitorService, OracleAlertService, FallbackStrategyService],
  exports: [OracleMonitorService, FallbackStrategyService],
})
export class OracleMonitorModule {}
