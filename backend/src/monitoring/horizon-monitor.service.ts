import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Horizon } from '@stellar/stellar-sdk';
import { AlertDispatcherService } from './alert-dispatcher.service';
import { AnomalyDetectorService } from './anomaly-detector.service';
import { loadMonitoringConfig, MonitoringConfig } from './monitoring.config';
import { MonitoringEvent } from './types';

type HorizonOperation = Horizon.ServerApi.OperationRecord & {
  transaction_hash?: string;
  transaction_successful?: boolean;
  amount?: string;
  asset_code?: string;
  from?: string;
  funder?: string;
  account?: string;
  trustee?: string;
  source_account?: string;
};

@Injectable()
export class HorizonMonitorService implements OnModuleInit {
  private readonly logger = new Logger(HorizonMonitorService.name);
  private readonly config: MonitoringConfig;
  private readonly server: Horizon.Server;
  private closeStream?: () => void;

  constructor(
    config: ConfigService,
    private readonly detector: AnomalyDetectorService,
    private readonly dispatcher: AlertDispatcherService,
  ) {
    this.config = loadMonitoringConfig(config);
    this.server = new Horizon.Server(this.config.horizonUrl, {
      allowHttp: this.config.horizonUrl.startsWith('http://'),
    });
  }

  onModuleInit(): void {
    if (!this.config.enabled) {
      this.logger.log('On-chain anomaly monitoring disabled');
      return;
    }
    this.closeStream = this.server
      .ledgers()
      .cursor('now')
      .stream({ onmessage: (ledger) => void this.processLedger(ledger), onerror: (error) => this.logger.error(`Horizon ledger stream error: ${String(error)}`) });
    this.logger.log(`Monitoring Stellar ledgers via Horizon SSE at ${this.config.horizonUrl}`);
  }

  async processLedger(ledger: Horizon.ServerApi.LedgerRecord): Promise<void> {
    const closedAt = new Date(ledger.closed_at);
    const latency = Date.now() - closedAt.getTime();
    if (latency > this.config.maxLedgerLatencyMs) {
      this.logger.warn(`Ledger ${ledger.sequence} processing latency ${latency}ms exceeds ${this.config.maxLedgerLatencyMs}ms`);
    }

    const operations = await this.server.operations().forLedger(Number(ledger.sequence)).limit(200).call();
    for (const operation of operations.records as HorizonOperation[]) {
      for (const event of this.toMonitoringEvents(operation, Number(ledger.sequence), closedAt)) {
        const alerts = this.detector.evaluate(event);
        for (const alert of alerts) await this.dispatcher.dispatch(alert);
      }
    }
  }

  close(): void {
    this.closeStream?.();
  }

  private toMonitoringEvents(operation: HorizonOperation, ledger: number, closedAt: Date): MonitoringEvent[] {
    const hash = operation.transaction_hash ?? operation.id;
    const account = operation.from ?? operation.funder ?? operation.account ?? operation.trustee ?? operation.source_account;
    const contractId = this.matchContract(String(operation.source_account ?? account ?? 'stellar'));
    const memo = JSON.stringify(operation).toLowerCase();
    const events: MonitoringEvent[] = [];

    if (operation.type === 'payment' || operation.type === 'create_claimable_balance') {
      const amount = Number(operation.amount ?? 0);
      if (Number.isFinite(amount) && amount > 0) {
        events.push({ ledger, closedAt, contractId, transactionHash: hash, type: 'invoice_funded', account, amount, asset: operation.asset_code });
      }
    }

    if (memo.includes('oracle') && memo.includes('price')) {
      const oraclePrice = this.extractNumber(operation, ['oracle_price', 'price']);
      const referencePrice = this.extractNumber(operation, ['reference_price', 'expected_price', 'twap']);
      events.push({ ledger, closedAt, contractId, transactionHash: hash, type: 'oracle_price_updated', account, oraclePrice, referencePrice });
    }

    if (memo.includes('pauser') || memo.includes('emergency_pauser')) {
      events.push({ ledger, closedAt, contractId, transactionHash: hash, type: 'role_changed', account, role: memo.includes('emergency_pauser') ? 'emergency_pauser' : 'pauser' });
    }

    return events;
  }

  private matchContract(candidate: string): string {
    return this.config.contractIds.find((id) => candidate.includes(id)) ?? candidate;
  }

  private extractNumber(operation: object, keys: string[]): number | undefined {
    const values = operation as Record<string, unknown>;
    for (const key of keys) {
      const value = Number(values[key]);
      if (Number.isFinite(value) && value > 0) return value;
    }
    return undefined;
  }
}
