import { Module } from '@nestjs/common';
import { AlertDispatcherService } from './alert-dispatcher.service';
import { AnomalyDetectorService } from './anomaly-detector.service';
import { HorizonMonitorService } from './horizon-monitor.service';

@Module({
  providers: [AlertDispatcherService, AnomalyDetectorService, HorizonMonitorService],
  exports: [AlertDispatcherService, AnomalyDetectorService, HorizonMonitorService],
})
export class MonitoringModule {}
