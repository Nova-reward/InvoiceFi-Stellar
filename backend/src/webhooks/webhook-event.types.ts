/**
 * Invoice lifecycle event types a webhook subscription can receive.
 *
 * Mirrors the (currently unwired, see docs/EXCLUDED_MODULES.md) websocket
 * `InvoiceEvent` shape in `src/notifications/invoice-event.dto.ts` so the two
 * notification channels agree on vocabulary if that module is re-enabled
 * later. Defined locally rather than imported from there because that
 * directory is excluded from the build (it depends on `@nestjs/websockets` /
 * `socket.io`, which are not installed).
 */
export type InvoiceEventType =
  | 'created'
  | 'submitted'
  | 'funded'
  | 'repaid'
  | 'defaulted';

export const ALL_INVOICE_EVENT_TYPES: readonly InvoiceEventType[] = [
  'created',
  'submitted',
  'funded',
  'repaid',
  'defaulted',
];

/** Wildcard event-type selector: subscribe to every lifecycle event. */
export const ALL_EVENTS_WILDCARD = '*';

/** The event payload delivered to a subscriber's webhook endpoint. */
export interface InvoiceEvent {
  /** The invoice's on-chain id, as a string (mirrors `Invoice.onchainId`). */
  invoiceId: string;
  event: InvoiceEventType;
  /** Wallet address that triggered the transition, when known. */
  actor?: string;
  /** ISO-8601 timestamp of the event. */
  timestamp: string;
  /** Event-specific extra fields (ledger, amounts, ...). */
  data?: Record<string, unknown>;
}
