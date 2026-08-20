import { Injectable } from '@nestjs/common';

/** Which crop/season a settlement-eligible invoice is associated with, for the yield gate. */
export interface InvoiceCropSeason {
  cropId: string;
  seasonId: string;
}

export const INVOICE_CROP_SEASON_RESOLVER = Symbol(
  'INVOICE_CROP_SEASON_RESOLVER',
);

/**
 * Resolves which crop/season (if any) an invoice is gated on. Kept
 * separate from {@link YieldGateService} so the gate itself doesn't need
 * to know *how* an invoice maps to a crop/season — today that mapping
 * doesn't exist anywhere yet (the `Invoice` model has no crop/season
 * columns; adding them is future work, tracked in the architecture doc's
 * "Out of scope" section), so the only implementation provided is the
 * null one below. A real implementation (backed by new `Invoice` columns,
 * once they exist) drops in behind this same interface with no changes
 * needed to `YieldGateService` or `SettlementSyncService`.
 */
export interface InvoiceCropSeasonResolver {
  /** Returns `undefined` when the invoice has no crop-yield gate association. */
  resolve(invoiceId: string): Promise<InvoiceCropSeason | undefined>;
}

/** Default resolver: no invoice is crop-yield-gated. Matches today's schema. */
@Injectable()
export class NullInvoiceCropSeasonResolver
  implements InvoiceCropSeasonResolver
{
  async resolve(_invoiceId: string): Promise<InvoiceCropSeason | undefined> {
    return undefined;
  }
}
