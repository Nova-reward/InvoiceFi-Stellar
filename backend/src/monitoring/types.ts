export type AnomalyType =
  | 'large_invoice_funding'
  | 'funding_volume_spike'
  | 'funding_velocity_spike'
  | 'oracle_price_deviation'
  | 'pauser_role_changed'
  | 'relative_volume_spike'
  | 'unusual_discount';

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
  discountRate?: number;
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
