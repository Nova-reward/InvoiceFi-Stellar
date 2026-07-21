import { Invoice, InvoiceStatus } from '@prisma/client';
import { buildFatfRecords } from './fatf';

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

const opts = {
  thresholdMinorUnits: 10000000n, // 1.0000000 asset units
  defaultAssetCode: 'USDC',
  assetDecimals: 7,
};

describe('buildFatfRecords', () => {
  it('emits a FINANCING record with investor as originator, farmer as beneficiary', () => {
    const records = buildFatfRecords([makeInvoice()], opts);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      transactionRef: '1:FINANCING',
      transactionType: 'FINANCING',
      originatorAccount: 'GINVESTOR',
      beneficiaryAccount: 'GFARMER',
      amountMinorUnits: '10000000',
      amountDecimal: '1.0000000',
      assetCode: 'USDC',
      kycStatus: 'UNAVAILABLE',
    });
    expect(records[0].originatorName).toBeNull();
  });

  it('excludes invoices with no investor (no transfer occurred)', () => {
    const records = buildFatfRecords(
      [makeInvoice({ investor: null, status: InvoiceStatus.PENDING })],
      opts,
    );
    expect(records).toHaveLength(0);
  });

  it('excludes transfers below the threshold', () => {
    const records = buildFatfRecords(
      [makeInvoice({ faceValue: 9999999n })],
      opts,
    );
    expect(records).toHaveLength(0);
  });

  it('emits both FINANCING and REPAYMENT rows for a repaid invoice', () => {
    const records = buildFatfRecords(
      [
        makeInvoice({
          status: InvoiceStatus.REPAID,
          settledLedger: 500,
          settledAt: new Date('2026-02-01T00:00:00.000Z'),
        }),
      ],
      opts,
    );

    expect(records.map((r) => r.transactionType)).toEqual([
      'FINANCING',
      'REPAYMENT',
    ]);
    const repayment = records[1];
    expect(repayment.originatorAccount).toBe('GFARMER');
    expect(repayment.beneficiaryAccount).toBe('GINVESTOR');
    expect(repayment.ledgerSequence).toBe(500);
    expect(repayment.transactionDate).toBe('2026-02-01T00:00:00.000Z');
  });

  it('uses fundedAmount and repaidAmount when recorded', () => {
    const records = buildFatfRecords(
      [
        makeInvoice({
          status: InvoiceStatus.REPAID,
          fundedAmount: 95000000n,
          repaidAmount: 100000000n,
          faceValue: 100000000n,
          settledAt: new Date('2026-03-01T00:00:00.000Z'),
        }),
      ],
      opts,
    );
    expect(records[0].amountMinorUnits).toBe('95000000');
    expect(records[1].amountMinorUnits).toBe('100000000');
  });

  it('honors the asset code recorded on the invoice', () => {
    const records = buildFatfRecords(
      [makeInvoice({ assetCode: 'EURC' })],
      opts,
    );
    expect(records[0].assetCode).toBe('EURC');
  });

  it('applies the date-range filter to transactionDate', () => {
    const records = buildFatfRecords([makeInvoice()], {
      ...opts,
      rangeStart: new Date('2026-06-01T00:00:00.000Z'),
    });
    expect(records).toHaveLength(0);
  });
});
