import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import { NormalizedEvent } from './types';

/**
 * Thin wrapper over the Soroban RPC `getEvents` endpoint. Decodes the
 * XDR-encoded topics/value of each event into native JS values so the rest of
 * the pipeline never touches XDR.
 */
@Injectable()
export class SorobanEventsService {
  private readonly logger = new Logger(SorobanEventsService.name);
  private readonly server: rpc.Server;
  private readonly contractIds: string[];

  constructor(config: ConfigService) {
    const url =
      config.get<string>('STELLAR_RPC_URL') ?? 'http://localhost:8001';
    this.server = new rpc.Server(url, { allowHttp: url.startsWith('http://') });

    this.contractIds = (config.get<string>('INVOICE_CONTRACT_ID') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  }

  /** Current ledger sequence on the network. */
  async getLatestLedger(): Promise<number> {
    const { sequence } = await this.server.getLatestLedger();
    return sequence;
  }

  /**
   * Fetch contract events starting at `startLedger` (inclusive), returning them
   * normalized along with the network's latest ledger so the caller can advance
   * its cursor past empty ranges.
   */
  async fetchEvents(
    startLedger: number,
  ): Promise<{ events: NormalizedEvent[]; latestLedger: number }> {
    const filters: rpc.Api.EventFilter[] = this.contractIds.length
      ? [{ type: 'contract', contractIds: this.contractIds }]
      : [];

    const response = await this.server.getEvents({ startLedger, filters });
    return {
      events: response.events.map((event) => this.normalize(event)),
      latestLedger: response.latestLedger,
    };
  }

  private normalize(event: rpc.Api.EventResponse): NormalizedEvent {
    const topics = (event.topic ?? []).map((t) => this.decode(t));
    return {
      ledger: event.ledger,
      contractId: String(event.contractId ?? ''),
      topics,
      value: this.decode(event.value),
    };
  }

  /** Decode a base64 XDR ScVal (or pass through an already-decoded value). */
  private decode(entry: unknown): unknown {
    try {
      const scval =
        typeof entry === 'string'
          ? xdr.ScVal.fromXDR(entry, 'base64')
          : (entry as xdr.ScVal);
      return scValToNative(scval);
    } catch (error) {
      this.logger.debug(`Failed to decode event entry: ${String(error)}`);
      return entry;
    }
  }
}
