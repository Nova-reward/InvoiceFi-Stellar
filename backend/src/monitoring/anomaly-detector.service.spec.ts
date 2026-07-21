import { ConfigService } from '@nestjs/config';
import { AnomalyDetectorService } from './anomaly-detector.service';
import { MonitoringEvent } from './types';

const detector = (values: Record<string, string>) =>
  new AnomalyDetectorService({ get: (key: string) => values[key] } as unknown as ConfigService);

const event = (overrides: Partial<MonitoringEvent>): MonitoringEvent => ({
  ledger: 123,
  closedAt: new Date('2026-07-20T00:00:00.000Z'),
  contractId: 'contract-1',
  transactionHash: 'tx-1',
  type: 'invoice_funded',
  account: 'funder-1',
  ...overrides,
});

describe('AnomalyDetectorService', () => {
  it('detects large funding, volume, and velocity anomalies', () => {
    const service = detector({
      ANOMALY_LARGE_FUNDING_AMOUNT: '100',
      ANOMALY_VOLUME_THRESHOLD: '250',
      ANOMALY_VOLUME_WINDOW_MS: '60000',
      ANOMALY_VELOCITY_COUNT_THRESHOLD: '2',
      ANOMALY_VELOCITY_WINDOW_MS: '60000',
    });

    expect(service.evaluate(event({ amount: 150 })).map((a) => a.anomalyType)).toContain('large_invoice_funding');
    const alerts = service.evaluate(event({ amount: 150, transactionHash: 'tx-2' })).map((a) => a.anomalyType);
    expect(alerts).toContain('funding_volume_spike');
    expect(alerts).toContain('funding_velocity_spike');
  });

  it('detects oracle deviations and pauser role changes', () => {
    const service = detector({ ANOMALY_ORACLE_DEVIATION_BPS: '500' });

    expect(service.evaluate(event({ type: 'oracle_price_updated', oraclePrice: 1.2, referencePrice: 1 })).map((a) => a.anomalyType)).toEqual(['oracle_price_deviation']);
    expect(service.evaluate(event({ type: 'role_changed', role: 'emergency_pauser' })).map((a) => a.anomalyType)).toEqual(['pauser_role_changed']);
  });
});
