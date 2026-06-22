import { parseSettlementEvent } from './settlement-event.parser';
import { NormalizedEvent } from './types';

function event(partial: Partial<NormalizedEvent>): NormalizedEvent {
  return {
    ledger: 100,
    contractId: 'C_INVOICE',
    topics: [],
    value: null,
    ...partial,
  };
}

describe('parseSettlementEvent', () => {
  it('parses an invoice_settled event with the id in the indexed topic', () => {
    const result = parseSettlementEvent(
      event({ topics: ['invoice_settled', '7'], ledger: 105 }),
    );
    expect(result).toEqual({ invoiceId: '7', ledger: 105 });
  });

  it('accepts a bigint or number invoice id', () => {
    expect(
      parseSettlementEvent(event({ topics: ['invoice_settled', 7n] })),
    ).toEqual({ invoiceId: '7', ledger: 100 });
    expect(
      parseSettlementEvent(event({ topics: ['invoice_settled', 12] })),
    ).toEqual({ invoiceId: '12', ledger: 100 });
  });

  it('falls back to the data payload for the invoice id', () => {
    const result = parseSettlementEvent(
      event({ topics: ['settled'], value: { invoice_id: '9' } }),
    );
    expect(result).toEqual({ invoiceId: '9', ledger: 100 });
  });

  it('matches the event name case-insensitively', () => {
    expect(
      parseSettlementEvent(event({ topics: ['InvoiceSettled', 5] })),
    ).toEqual({ invoiceId: '5', ledger: 100 });
  });

  it('ignores non-settlement events', () => {
    expect(parseSettlementEvent(event({ topics: ['mint', '1'] }))).toBeNull();
    expect(
      parseSettlementEvent(event({ topics: ['transfer', '1', '2'] })),
    ).toBeNull();
  });

  it('returns null when no invoice id can be extracted', () => {
    expect(parseSettlementEvent(event({ topics: ['invoice_settled'] }))).toBeNull();
    expect(
      parseSettlementEvent(event({ topics: ['invoice_settled', 'not-a-number'] })),
    ).toBeNull();
  });

  it('rejects a zero invoice id', () => {
    expect(
      parseSettlementEvent(event({ topics: ['invoice_settled', '0'] })),
    ).toBeNull();
  });

  it('returns null for an empty topic list', () => {
    expect(parseSettlementEvent(event({ topics: [] }))).toBeNull();
  });
});
