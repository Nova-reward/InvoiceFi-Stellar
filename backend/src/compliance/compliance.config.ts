import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_ASSET_DECIMALS } from './amount';

/**
 * Deployment-level compliance settings, read once from configuration.
 * Centralized so the FATF threshold, reporting asset, and schema version are
 * consistent across every export path and easy to document.
 */
@Injectable()
export class ComplianceConfig {
  /** Export document schema version, surfaced in every document envelope. */
  readonly schemaVersion = '1.0';
  readonly assetCode: string;
  readonly assetDecimals: number;
  /** FATF Travel Rule threshold as a decimal string in whole asset units. */
  readonly defaultThresholdDecimal: string;

  constructor(config: ConfigService) {
    this.assetCode = config.get<string>('COMPLIANCE_ASSET_CODE') ?? 'USDC';
    this.assetDecimals = Number(
      config.get('COMPLIANCE_ASSET_DECIMALS') ?? DEFAULT_ASSET_DECIMALS,
    );
    this.defaultThresholdDecimal =
      config.get<string>('FATF_TRAVEL_RULE_THRESHOLD') ?? '1000';
  }
}
