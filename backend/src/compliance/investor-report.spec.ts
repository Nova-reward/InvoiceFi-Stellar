import { Invoice, InvoiceStatus } from '@prisma/client';
import { buildInvestorReport } from './investor-report';

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 1,
    onchainId: 1n,
    status: InvoiceStatus.FUNDED,
    faceValue: 10000000n,
    farmer: 'GFARMER',
    investor: 'GINVESTOR',
    settledLedger: null,
    settledAt: null,
    fundedAmount: null,
    repaidAmount: null,
    assetCode: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

const opts = { defaultAssetCode: 'USDC', assetDecimals: 7 };

describe('buildInvestorReport', () => {
  it('ignores invoices funded by a different investor', () => {
    const report = buildInvestorReport(
      'GINVESTOR',
      [makeInvoice({ investor: 'GOTHER' })],
      opts,
    );
    expect(report.positions).toHaveLength(0);
    expect(report.summary.totalInvoices).toBe(0);
  });

  it('computes realized P&L on a repaid invoice (proceeds - cost basis)', () => {
    const report = buildInvestorReport(
      'GINVESTOR',
      [
        makeInvoice({
          onchainId: 7n,
          status: InvoiceStatus.REPAID,
          fundedAmount: 95000000n,
          repaidAmount: 100000000n,
          faceValue: 100000000n,
        }),
      ],
      opts,
    );

    expect(report.summary.repaidCount).toBe(1);
    expect(report.summary.realizedProceeds.minorUnits).toBe('100000000');
    expect(report.summary.realizedPnl.minorUnits).toBe('5000000');
    expect(report.positions[0].realizedPnlMinorUnits).toBe('5000000');
  });

  it('realizes a loss of the cost basis on default', () => {
    const report = buildInvestorReport(
      'GINVESTOR',
      [
        makeInvoice({
          status: InvoiceStatus.DEFAULTED,
          fundedAmount: 90000000n,
        }),
      ],
      opts,
    );
    expect(report.summary.defaultedCount).toBe(1);
    expect(report.summary.realizedPnl.minorUnits).toBe('-90000000');
    expect(report.summary.defaultedCostBasis.minorUnits).toBe('90000000');
  });

  it('reports unrealized value for open (FUNDED) positions', () => {
    const report = buildInvestorReport(
      'GINVESTOR',
      [
        makeInvoice({
          status: InvoiceStatus.FUNDED,
          fundedAmount: 95000000n,
          faceValue: 100000000n,
        }),
      ],
      opts,
    );
    expect(report.summary.fundedCount).toBe(1);
    expect(report.summary.outstandingCostBasis.minorUnits).toBe('95000000');
    expect(report.summary.unrealizedValue.minorUnits).toBe('5000000');
    expect(report.summary.realizedPnl.minorUnits).toBe('0');
  });

  it('falls back to faceValue (par) when economic terms are absent', () => {
    const report = buildInvestorReport(
      'GINVESTOR',
      [makeInvoice({ status: InvoiceStatus.REPAID, faceValue: 10000000n })],
      opts,
    );
    // cost basis = proceeds = faceValue => zero realized P&L.
    expect(report.positions[0].costBasisMinorUnits).toBe('10000000');
    expect(report.summary.realizedPnl.minorUnits).toBe('0');
  });

  it('aggregates a mixed portfolio', () => {
    const report = buildInvestorReport(
      'GINVESTOR',
      [
        makeInvoice({ onchainId: 1n, status: InvoiceStatus.FUNDED }),
        makeInvoice({
          onchainId: 2n,
          status: InvoiceStatus.REPAID,
          fundedAmount: 9000000n,
          repaidAmount: 10000000n,
        }),
        makeInvoice({ onchainId: 3n, status: InvoiceStatus.DEFAULTED }),
      ],
      opts,
    );
    expect(report.summary.totalInvoices).toBe(3);
    expect(report.summary.fundedCount).toBe(1);
    expect(report.summary.repaidCount).toBe(1);
    expect(report.summary.defaultedCount).toBe(1);
    // realized: +1_000_000 (repaid) - 10_000_000 (default cost basis)
    expect(report.summary.realizedPnl.minorUnits).toBe('-9000000');
  });
});
