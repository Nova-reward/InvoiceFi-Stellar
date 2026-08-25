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
      ANOMALY_RELATIVE_VOLUME_SPIKE_ENABLED: 'false', // disable for this test
      ANOMALY_UNUSUAL_DISCOUNT_ENABLED: 'false', // disable for this test
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

  it('detects relative volume spikes', () => {
    const service = detector({
      ANOMALY_RELATIVE_VOLUME_SPIKE_ENABLED: 'true',
      ANOMALY_RELATIVE_VOLUME_SPIKE_MULTIPLE: '3',
      ANOMALY_VOLUME_THRESHOLD: '99999', // disable absolute volume spike
    });

    // Feed some history to set the average
    // 2016 intervals in 7 days. If total volume is 20160, average 5-min volume is 10.
    // So threshold is 10 * 3 = 30.
    service.evaluate(event({ amount: 20160, closedAt: new Date(Date.now() - 1000) })); // Not a spike since threshold is 0 before this. Wait, threshold is 0, so it will trigger.
    
    // Let's create a new service and test below, at, and above.
    const service2 = detector({
      ANOMALY_RELATIVE_VOLUME_SPIKE_ENABLED: 'true',
      ANOMALY_RELATIVE_VOLUME_SPIKE_MULTIPLE: '3',
      ANOMALY_VOLUME_THRESHOLD: '999999',
    });
    
    // Add history. Since threshold > 0, we can add 20160 total volume in previous events.
    service2.evaluate(event({ amount: 10080, closedAt: new Date(Date.now() - 10000), transactionHash: 'tx-hist1' }));
    service2.evaluate(event({ amount: 10080, closedAt: new Date(Date.now() - 5000), transactionHash: 'tx-hist2' }));
    
    // Average 5-min volume is now 20160 / 2016 = 10.
    // Threshold is 10 * 3 = 30.
    
    // Below threshold (20)
    let alerts = service2.evaluate(event({ amount: 20, transactionHash: 'tx-below' })).map(a => a.anomalyType);
    expect(alerts).not.toContain('relative_volume_spike');
    
    // At threshold (10, making total volume 20 + 10 = 30 in 5 min window)
    alerts = service2.evaluate(event({ amount: 10, transactionHash: 'tx-at' })).map(a => a.anomalyType);
    expect(alerts).toContain('relative_volume_spike');
    
    // Above threshold
    alerts = service2.evaluate(event({ amount: 50, transactionHash: 'tx-above' })).map(a => a.anomalyType);
    expect(alerts).toContain('relative_volume_spike');
  });

  it('detects unusual discount rates', () => {
    const service = detector({
      ANOMALY_UNUSUAL_DISCOUNT_ENABLED: 'true',
      ANOMALY_UNUSUAL_DISCOUNT_STD_DEV_MULTIPLE: '3',
    });

    // Requires at least 2 points to establish a mean/stddev.
    // Let's add points with 0.1 discount rate.
    service.evaluate(event({ amount: 100, discountRate: 0.10, transactionHash: 'tx-hist1' }));
    service.evaluate(event({ amount: 100, discountRate: 0.12, transactionHash: 'tx-hist2' }));
    service.evaluate(event({ amount: 100, discountRate: 0.08, transactionHash: 'tx-hist3' }));
    
    // Mean = (0.10 + 0.12 + 0.08) / 3 = 0.10
    // Variance = ((0)^2 + (0.02)^2 + (-0.02)^2) / 3 = (0 + 0.0004 + 0.0004) / 3 = 0.0008 / 3 ≈ 0.000266
    // StdDev ≈ 0.0163299
    // Max deviation = 3 * 0.0163299 ≈ 0.048989
    // Threshold high = 0.10 + 0.048989 ≈ 0.148989
    // Threshold low = 0.10 - 0.048989 ≈ 0.051011

    // Below deviation (0.13)
    let alerts = service.evaluate(event({ amount: 100, discountRate: 0.13, transactionHash: 'tx-below' })).map(a => a.anomalyType);
    expect(alerts).not.toContain('unusual_discount');

    // At/Above threshold high (0.15)
    alerts = service.evaluate(event({ amount: 100, discountRate: 0.15, transactionHash: 'tx-above-high' })).map(a => a.anomalyType);
    expect(alerts).toContain('unusual_discount');
    
    // At/Above threshold low (0.05)
    alerts = service.evaluate(event({ amount: 100, discountRate: 0.05, transactionHash: 'tx-above-low' })).map(a => a.anomalyType);
    expect(alerts).toContain('unusual_discount');
  });
});
