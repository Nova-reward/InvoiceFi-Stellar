import { Invoice } from '@prisma/client';
import { DEFAULT_ASSET_DECIMALS, minorUnitsToDecimal } from './amount';

/**
 * FATF Recommendation 16 ("Travel Rule") record construction.
 *
 * For each value transfer above the threshold, FATF requires originator and
 * beneficiary information plus the transaction particulars. In this system a
 * financed invoice produces up to two reportable transfers:
 *
 *   - FINANCING  — the investor (originator) advances funds to the farmer
 *                  (beneficiary) when the invoice is funded.
 *   - REPAYMENT  — the farmer/payer (originator) repays the investor
 *                  (beneficiary) when the invoice settles.
 *
 * Originator/beneficiary *names* and physical addresses come from KYC data,
 * which is collected separately (out of scope). Those fields are therefore
 * emitted as null with a `kycStatus` marker so the gap is explicit in the
 * export rather than silently omitted.
 */

export type FatfTransactionType = 'FINANCING' | 'REPAYMENT';

export interface FatfRecord {
  /** Stable per-transfer reference, e.g. "42:FINANCING". */
  transactionRef: string;
  /** On-chain invoice id this transfer belongs to. */
  invoiceOnchainId: string;
  transactionType: FatfTransactionType;
  /** ISO-8601 timestamp of the transfer (best available). */
  transactionDate: string;
  /** Ledger sequence when known (repayments only). */
  ledgerSequence: number | null;
  invoiceStatus: string;

  // Originator (sender of funds)
  originatorAccount: string;
  originatorName: string | null;

  // Beneficiary (receiver of funds)
  beneficiaryAccount: string;
  beneficiaryName: string | null;

  // Amount
  amountMinorUnits: string;
  amountDecimal: string;
  assetCode: string;

  /** Marks that originator/beneficiary identity requires KYC data. */
  kycStatus: 'UNAVAILABLE';
}

/** Ordered column set for CSV exports; also documents the JSON field order. */
export const FATF_FIELDS: (keyof FatfRecord)[] = [
  'transactionRef',
  'invoiceOnchainId',
  'transactionType',
  'transactionDate',
  'ledgerSequence',
  'invoiceStatus',
  'originatorAccount',
  'originatorName',
  'beneficiaryAccount',
  'beneficiaryName',
  'amountMinorUnits',
  'amountDecimal',
  'assetCode',
  'kycStatus',
];

export interface FatfBuildOptions {
  /** Inclusive lower bound on transfer amount, in minor units. */
  thresholdMinorUnits: bigint;
  /** Default asset code when an invoice does not record its own. */
  defaultAssetCode: string;
  /** Decimal precision for `amountDecimal`. */
  assetDecimals?: number;
  /** Inclusive date-range filter on `transactionDate`. */
  rangeStart?: Date;
  rangeEnd?: Date;
}

function withinRange(date: Date, start?: Date, end?: Date): boolean {
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

function record(
  invoice: Invoice,
  type: FatfTransactionType,
  fields: {
    date: Date;
    ledger: number | null;
    originator: string;
    beneficiary: string;
    amount: bigint;
    assetCode: string;
    decimals: number;
  },
): FatfRecord {
  return {
    transactionRef: `${invoice.onchainId.toString()}:${type}`,
    invoiceOnchainId: invoice.onchainId.toString(),
    transactionType: type,
    transactionDate: fields.date.toISOString(),
    ledgerSequence: fields.ledger,
    invoiceStatus: invoice.status,
    originatorAccount: fields.originator,
    originatorName: null,
    beneficiaryAccount: fields.beneficiary,
    beneficiaryName: null,
    amountMinorUnits: fields.amount.toString(),
    amountDecimal: minorUnitsToDecimal(fields.amount, fields.decimals),
    assetCode: fields.assetCode,
    kycStatus: 'UNAVAILABLE',
  };
}

/**
 * Build the FATF Travel Rule records for a set of invoices, keeping only
 * transfers at or above the threshold (and within the date range, if given).
 * Only invoices that have an investor represent an actual value transfer, so
 * un-funded (PENDING) invoices contribute nothing.
 */
export function buildFatfRecords(
  invoices: Invoice[],
  options: FatfBuildOptions,
): FatfRecord[] {
  const decimals = options.assetDecimals ?? DEFAULT_ASSET_DECIMALS;
  const records: FatfRecord[] = [];

  for (const invoice of invoices) {
    // No counterparty means no transfer occurred yet.
    if (!invoice.investor) continue;
    const assetCode = invoice.assetCode ?? options.defaultAssetCode;

    // FINANCING: investor -> farmer. Funded price when recorded, else par.
    const financedAmount = invoice.fundedAmount ?? invoice.faceValue;
    const financedDate = invoice.createdAt;
    if (
      financedAmount >= options.thresholdMinorUnits &&
      withinRange(financedDate, options.rangeStart, options.rangeEnd)
    ) {
      records.push(
        record(invoice, 'FINANCING', {
          date: financedDate,
          ledger: null,
          originator: invoice.investor,
          beneficiary: invoice.farmer,
          amount: financedAmount,
          assetCode,
          decimals,
        }),
      );
    }

    // REPAYMENT: farmer/payer -> investor, only once the invoice is repaid.
    if (invoice.status === 'REPAID') {
      const repaidAmount = invoice.repaidAmount ?? invoice.faceValue;
      const repaidDate = invoice.settledAt ?? invoice.updatedAt;
      if (
        repaidAmount >= options.thresholdMinorUnits &&
        withinRange(repaidDate, options.rangeStart, options.rangeEnd)
      ) {
        records.push(
          record(invoice, 'REPAYMENT', {
            date: repaidDate,
            ledger: invoice.settledLedger ?? null,
            originator: invoice.farmer,
            beneficiary: invoice.investor,
            amount: repaidAmount,
            assetCode,
            decimals,
          }),
        );
      }
    }
  }

  return records;
}
