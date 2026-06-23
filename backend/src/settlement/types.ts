/**
 * A Soroban contract event, normalized to native JavaScript values.
 *
 * The raw RPC response carries XDR-encoded `topic`/`value` entries; the
 * `SorobanEventsService` decodes them with the Stellar SDK before they reach
 * the parser, so everything downstream works with plain JS values.
 */
export interface NormalizedEvent {
  /** Ledger sequence the event was emitted in. */
  ledger: number;
  /** Emitting contract id (StrKey `C...`). */
  contractId: string;
  /** Decoded topic values. Topic 0 is conventionally the event name symbol. */
  topics: unknown[];
  /** Decoded event data payload. */
  value: unknown;
}

/** A successfully parsed `InvoiceSettled` event. */
export interface SettlementEvent {
  /** On-chain invoice id, kept as a string to preserve u64 precision. */
  invoiceId: string;
  /** Ledger sequence the settlement was observed in. */
  ledger: number;
}
