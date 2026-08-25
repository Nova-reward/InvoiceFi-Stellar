export type InvoiceEventType =
  | 'created'
  | 'submitted'
  | 'funded'
  | 'repaid'
  | 'defaulted';

export interface InvoiceEvent {
  invoiceId: number;
  event: InvoiceEventType;
  actor?: string;
  timestamp: string;
}
