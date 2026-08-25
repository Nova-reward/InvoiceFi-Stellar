export type AnomalyType =
  | 'large_invoice_funding'
  | 'funding_volume_spike'
  | 'funding_velocity_spike'
  | 'oracle_price_deviation'
  | 'pauser_role_changed';

export interface MonitoringEvent {
  ledger: number;
  closedAt: Date;
  contractId: string;
  transactionHash: string;
  type: string;
  account?: string;
  amount?: number;
  asset?: string;
  oraclePrice?: number;
  referencePrice?: number;
  role?: string;
  oldValue?: string;
  newValue?: string;
}

export interface AnomalyAlert {
  id: string;
  anomalyType: AnomalyType;
  affectedAccountOrContract: string;
  transactionHash: string;
  currentMetric: number | string;
  threshold: number | string;
  ledger: number;
  occurredAt: string;
  severity: 'warning' | 'critical';
  summary: string;
  context: Record<string, unknown>;
}
