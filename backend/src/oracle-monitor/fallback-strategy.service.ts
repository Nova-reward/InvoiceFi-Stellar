import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FallbackMode, OracleMonitorConfig } from './oracle-monitor.types';
import { loadOracleMonitorConfig } from './oracle-monitor.config';

interface FallbackState {
  mode: FallbackMode;
  riskPremiumBps: number;
  activatedAt: Date;
  reason: string;
}

@Injectable()
export class FallbackStrategyService {
  private readonly logger = new Logger(FallbackStrategyService.name);
  private readonly config: OracleMonitorConfig;
  private state: FallbackState | null = null;

  constructor(config: ConfigService) {
    this.config = loadOracleMonitorConfig(config);
  }

  async activate(params: {
    mode: FallbackMode;
    riskPremiumBps: number;
    reason: string;
  }): Promise<void> {
    if (this.state) {
      this.logger.warn('Fallback already active, ignoring duplicate activation');
      return;
    }

    this.state = {
      mode: params.mode,
      riskPremiumBps: Math.min(params.riskPremiumBps, this.config.maxRiskPremiumBps),
      activatedAt: new Date(),
      reason: params.reason,
    };

    this.logger.warn(
      `Fallback activated: mode=${params.mode}, riskPremium=${this.state.riskPremiumBps}bps, reason="${params.reason}"`,
    );
  }

  async deactivate(): Promise<void> {
    if (!this.state) {
      this.logger.debug('No fallback active, ignoring deactivation');
      return;
    }

    this.logger.log(
      `Fallback deactivated (was ${this.state.mode} since ${this.state.activatedAt.toISOString()})`,
    );
    this.state = null;
  }

  getActiveMode(): FallbackMode {
    return this.state?.mode ?? 'none';
  }

  getRiskPremiumBps(): number {
    return this.state?.riskPremiumBps ?? 0;
  }

  getActiveState(): FallbackState | null {
    return this.state ? { ...this.state } : null;
  }

  isHaltMode(): boolean {
    return this.state?.mode === 'halt';
  }

  calculateEffectiveDiscountBps(baseDiscountBps: number): number {
    if (!this.state) return baseDiscountBps;
    const adjusted = baseDiscountBps + this.state.riskPremiumBps;
    return Math.min(adjusted, this.config.maxRiskPremiumBps);
  }

  shouldBlockFunding(): boolean {
    return this.state?.mode === 'halt';
  }
}
