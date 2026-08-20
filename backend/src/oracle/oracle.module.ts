import { Module } from '@nestjs/common';
import { WeatherAgronomicAdapter } from './adapters/weather-agronomic.adapter';
import { GovernmentCropReportingAdapter } from './adapters/government-crop-reporting.adapter';
import {
  RECONCILIATION_POLICY,
  YIELD_DATA_ADAPTERS,
  YieldReconciliationService,
} from './yield-reconciliation.service';
import {
  InMemoryYieldAttestationQueue,
  YIELD_ATTESTATION_QUEUE,
} from './yield-attestation-queue';
import {
  INVOICE_CROP_SEASON_RESOLVER,
  NullInvoiceCropSeasonResolver,
} from './invoice-crop-season-resolver';
import { DEFAULT_RECONCILIATION_POLICY } from './yield-attestation.types';
import { YieldGateService } from './yield-gate.service';

@Module({
  providers: [
    WeatherAgronomicAdapter,
    GovernmentCropReportingAdapter,
    {
      provide: YIELD_DATA_ADAPTERS,
      useFactory: (
        weather: WeatherAgronomicAdapter,
        government: GovernmentCropReportingAdapter,
      ) => [weather, government],
      inject: [WeatherAgronomicAdapter, GovernmentCropReportingAdapter],
    },
    { provide: RECONCILIATION_POLICY, useValue: DEFAULT_RECONCILIATION_POLICY },
    { provide: YIELD_ATTESTATION_QUEUE, useClass: InMemoryYieldAttestationQueue },
    {
      provide: INVOICE_CROP_SEASON_RESOLVER,
      useClass: NullInvoiceCropSeasonResolver,
    },
    YieldReconciliationService,
    YieldGateService,
  ],
  exports: [YieldReconciliationService, YieldGateService],
})
export class OracleModule {}
