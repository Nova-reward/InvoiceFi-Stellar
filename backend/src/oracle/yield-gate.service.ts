import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  YIELD_ATTESTATION_QUEUE,
  YieldAttestationQueue,
} from './yield-attestation-queue';
import { YieldAttestationStatus } from './yield-attestation.types';
import {
  INVOICE_CROP_SEASON_RESOLVER,
  InvoiceCropSeasonResolver,
} from './invoice-crop-season-resolver';

/**
 * The optional hook `SettlementSyncService` consults before marking an
 * invoice settled. Disabled by default (`YIELD_GATE_ENABLED` unset or not
 * `"true"`) so existing deployments and every invoice without a
 * crop/season association are entirely unaffected — this is strictly
 * additive. See `docs/architecture/crop-yield-oracle-pipeline.md` for the
 * full design.
 */
@Injectable()
export class YieldGateService {
  private readonly logger = new Logger(YieldGateService.name);
  private readonly enabled: boolean;

  constructor(
    @Inject(YIELD_ATTESTATION_QUEUE)
    private readonly queue: YieldAttestationQueue,
    @Inject(INVOICE_CROP_SEASON_RESOLVER)
    private readonly resolver: InvoiceCropSeasonResolver,
    config: ConfigService,
  ) {
    this.enabled = config.get('YIELD_GATE_ENABLED') === 'true';
  }

  /**
   * Whether `invoiceId` may be settled right now. `true` whenever the gate
   * is disabled, or the invoice has no crop/season association, or its
   * crop/season has a `RECONCILED` attestation. `false` (settlement should
   * be deferred and retried later, not failed) when the invoice is gated
   * and the attestation is missing, `DISPUTED`, or `INSUFFICIENT_DATA`.
   */
  async isSettlementAllowed(invoiceId: string): Promise<boolean> {
    if (!this.enabled) return true;

    const association = await this.resolver.resolve(invoiceId);
    if (!association) return true;

    const attestation = await this.queue.peek(
      association.cropId,
      association.seasonId,
    );
    if (!attestation) {
      this.logger.debug(
        `Invoice ${invoiceId} gated on ${association.cropId}/${association.seasonId}: no attestation yet`,
      );
      return false;
    }
    if (attestation.status !== YieldAttestationStatus.RECONCILED) {
      this.logger.debug(
        `Invoice ${invoiceId} gated on ${association.cropId}/${association.seasonId}: attestation status is ${attestation.status}`,
      );
      return false;
    }
    return true;
  }
}
