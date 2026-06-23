import { NormalizedEvent, SettlementEvent } from './types';

/**
 * Topic symbols that identify an invoice-settlement event. The settlement
 * contract publishes `invoice_settled`; we also accept a couple of common
 * spellings so the listener is resilient to naming differences across contract
 * versions.
 */
const SETTLEMENT_TOPICS = new Set([
  'invoice_settled',
  'invoicesettled',
  'settled',
]);

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value).toString();
  }
  return null;
}

function isPositiveIntString(value: string): boolean {
  return /^[0-9]+$/.test(value) && value !== '0';
}

/** Extract an invoice id from a topic/value that may be a scalar or an object. */
function extractInvoiceId(candidate: unknown): string | null {
  const direct = asString(candidate);
  if (direct && isPositiveIntString(direct)) return direct;

  if (candidate && typeof candidate === 'object') {
    const record = candidate as Record<string, unknown>;
    for (const key of ['invoice_id', 'invoiceId', 'id']) {
      const nested = asString(record[key]);
      if (nested && isPositiveIntString(nested)) return nested;
    }
  }
  return null;
}

/**
 * Parse a normalized Soroban event into a {@link SettlementEvent}, or return
 * `null` when the event is not an invoice settlement.
 *
 * Recognizes events whose first topic is a settlement symbol. The invoice id is
 * read from the second topic (the conventional indexed field) and falls back to
 * the event data payload.
 */
export function parseSettlementEvent(
  event: NormalizedEvent,
): SettlementEvent | null {
  const [name, indexedId] = event.topics ?? [];

  const eventName = asString(name)?.toLowerCase();
  if (!eventName || !SETTLEMENT_TOPICS.has(eventName)) {
    return null;
  }

  const invoiceId =
    extractInvoiceId(indexedId) ?? extractInvoiceId(event.value);
  if (!invoiceId) {
    return null;
  }

  return { invoiceId, ledger: event.ledger };
}
