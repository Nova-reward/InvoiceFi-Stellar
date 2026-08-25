import { Invoice } from '@prisma/client';
import { DEFAULT_ASSET_DECIMALS, minorUnitsToDecimal } from './amount';

/**
 * Investor portfolio report with realized/unrealized P&L.
 *
 * P&L methodology (documented in docs/compliance/export-schema.md):
 *   - cost basis  = `fundedAmount` when recorded, else `faceValue` (par).
 *   - proceeds    = `repaidAmount` when recorded, else `faceValue` at maturity.
 *   - realized P&L accrues on REPAID invoices as proceeds − cost basis.
 *   - DEFAULTED invoices realize a loss of their cost basis.
 *   - FUNDED (open) invoices contribute unrealized value = faceValue − cost.
 *
 * All monetary figures are integer minor units, surfaced as both an exact
 * string and a decimal rendering.
 */

export interface InvestorPosition {
  invoiceOnchainId: string;
  status: string;
  farmer: string;
  assetCode: string;
  faceValueMinorUnits: string;
  costBasisMinorUnits: string;
  proceedsMinorUnits: string | null;
  realizedPnlMinorUnits: string | null;
  unrealizedValueMinorUnits: string | null;
  fundedAt: string;
  settledAt: string | null;
}

/** Column order for the investor-report CSV (positions form the rows). */
export const INVESTOR_POSITION_FIELDS: (keyof InvestorPosition)[] = [
  'invoiceOnchainId',
  'status',
  'farmer',
  'assetCode',
  'faceValueMinorUnits',
  'costBasisMinorUnits',
  'proceedsMinorUnits',
  'realizedPnlMinorUnits',
  'unrealizedValueMinorUnits',
  'fundedAt',
  'settledAt',
];

export interface Money {
  minorUnits: string;
  decimal: string;
}

export interface InvestorReportSummary {
  totalInvoices: number;
  fundedCount: number;
  repaidCount: number;
  defaultedCount: number;
  totalFaceValue: Money;
  totalCostBasis: Money;
  realizedProceeds: Money;
  realizedPnl: Money;
  outstandingCostBasis: Money;
  defaultedCostBasis: Money;
  unrealizedValue: Money;
}

export interface InvestorReport {
  investor: string;
  assetCode: string;
  positions: InvestorPosition[];
  summary: InvestorReportSummary;
}

export interface InvestorReportOptions {
  defaultAssetCode: string;
  assetDecimals?: number;
}

function costBasis(invoice: Invoice): bigint {
  return invoice.fundedAmount ?? invoice.faceValue;
}

export function buildInvestorReport(
  investor: string,
  invoices: Invoice[],
  options: InvestorReportOptions,
): InvestorReport {
  const decimals = options.assetDecimals ?? DEFAULT_ASSET_DECIMALS;
  const money = (value: bigint): Money => ({
    minorUnits: value.toString(),
    decimal: minorUnitsToDecimal(value, decimals),
  });

  const positions: InvestorPosition[] = [];
  let fundedCount = 0;
  let repaidCount = 0;
  let defaultedCount = 0;
  let totalFaceValue = 0n;
  let totalCostBasis = 0n;
  let realizedProceeds = 0n;
  let realizedPnl = 0n;
  let outstandingCostBasis = 0n;
  let defaultedCostBasis = 0n;
  let unrealizedValue = 0n;

  for (const invoice of invoices) {
    if (invoice.investor !== investor) continue;

    const assetCode = invoice.assetCode ?? options.defaultAssetCode;
    const basis = costBasis(invoice);
    totalFaceValue += invoice.faceValue;
    totalCostBasis += basis;

    let proceeds: bigint | null = null;
    let positionRealizedPnl: bigint | null = null;
    let positionUnrealized: bigint | null = null;

    switch (invoice.status) {
      case 'REPAID': {
        repaidCount += 1;
        proceeds = invoice.repaidAmount ?? invoice.faceValue;
        positionRealizedPnl = proceeds - basis;
        realizedProceeds += proceeds;
        realizedPnl += positionRealizedPnl;
        break;
      }
      case 'DEFAULTED': {
        defaultedCount += 1;
        proceeds = 0n;
        positionRealizedPnl = -basis;
        realizedPnl += positionRealizedPnl;
        defaultedCostBasis += basis;
        break;
      }
      case 'FUNDED': {
        fundedCount += 1;
        positionUnrealized = invoice.faceValue - basis;
        outstandingCostBasis += basis;
        unrealizedValue += positionUnrealized;
        break;
      }
      default:
        // PENDING invoices are not yet a funded position for this investor.
        break;
    }

    positions.push({
      invoiceOnchainId: invoice.onchainId.toString(),
      status: invoice.status,
      farmer: invoice.farmer,
      assetCode,
      faceValueMinorUnits: invoice.faceValue.toString(),
      costBasisMinorUnits: basis.toString(),
      proceedsMinorUnits: proceeds === null ? null : proceeds.toString(),
      realizedPnlMinorUnits:
        positionRealizedPnl === null ? null : positionRealizedPnl.toString(),
      unrealizedValueMinorUnits:
        positionUnrealized === null ? null : positionUnrealized.toString(),
      fundedAt: invoice.createdAt.toISOString(),
      settledAt: invoice.settledAt?.toISOString() ?? null,
    });
  }

  return {
    investor,
    assetCode: options.defaultAssetCode,
    positions,
    summary: {
      totalInvoices: positions.length,
      fundedCount,
      repaidCount,
      defaultedCount,
      totalFaceValue: money(totalFaceValue),
      totalCostBasis: money(totalCostBasis),
      realizedProceeds: money(realizedProceeds),
      realizedPnl: money(realizedPnl),
      outstandingCostBasis: money(outstandingCostBasis),
      defaultedCostBasis: money(defaultedCostBasis),
      unrealizedValue: money(unrealizedValue),
    },
  };
}
