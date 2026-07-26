import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'events';
import { parseSettlementEvent } from './settlement-event.parser';
import { SettlementEvent } from './types';

/**
 * Horizon SSE stream state for reconnection logic.
 */
interface StreamState {
  /** Current retry delay in milliseconds. */
  retryDelay: number;
  /** Total consecutive failures. */
  consecutiveFailures: number;
  /** Whether the stream is currently connected. */
  connected: boolean;
  /** Last successful connection timestamp. */
  lastConnected: Date | null;
  /** Total events received since last connection. */
  eventsReceived: number;
}

/**
 * Configuration for Horizon streaming.
 */
interface HorizonStreamConfig {
  /** Base delay for exponential backoff (ms). */
  baseRetryDelay: number;
  /** Maximum retry delay (ms). */
  maxRetryDelay: number;
  /** Maximum consecutive failures before alerting. */
  maxConsecutiveFailures: number;
  /** Connection timeout (ms). */
  connectionTimeout: number;
  /** Whether to automatically reconnect. */
  autoReconnect: boolean;
}

const DEFAULT_CONFIG: HorizonStreamConfig = {
  baseRetryDelay: 1000,
  maxRetryDelay: 30000,
  maxConsecutiveFailures: 10,
  connectionTimeout: 10000,
  autoReconnect: true,
};

/**
 * Service that streams real-time events from Horizon SSE endpoint.
 * 
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Event parsing and normalization
 * - Connection state monitoring
 * - Event broadcasting to interested parties
 * 
 * Horizon SSE endpoint: https://horizon.stellar.org/events
 * For testnet: https://horizon-testnet.stellar.org/events
 */
@Injectable()
export class HorizonStreamService implements OnModuleDestroy {
  private readonly logger = new Logger(HorizonStreamService.name);
  private readonly config: HorizonStreamConfig;
  private readonly state: StreamState = {
    retryDelay: DEFAULT_CONFIG.baseRetryDelay,
    consecutiveFailures: 0,
    connected: false,
    lastConnected: null,
    eventsReceived: 0,
  };

  private eventEmitter: EventEmitter;
  private abortController: AbortController | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private readonly horizonUrl: string;

  constructor(private configService: ConfigService) {
    this.config = { ...DEFAULT_CONFIG };
    
    // Override config from environment
    const envBaseDelay = configService.get('HORIZON_RETRY_BASE_MS');
    if (envBaseDelay) this.config.baseRetryDelay = Number(envBaseDelay);

    const envMaxDelay = configService.get('HORIZON_RETRY_MAX_MS');
    if (envMaxDelay) this.config.maxRetryDelay = Number(envMaxDelay);

    const envMaxFailures = configService.get('HORIZON_MAX_FAILURES');
    if (envMaxFailures) this.config.maxConsecutiveFailures = Number(envMaxFailures);

    // Determine Horizon URL based on network
    const network = configService.get('STELLAR_NETWORK') ?? 'testnet';
    if (network === 'mainnet') {
      this.horizonUrl = 'https://horizon.stellar.org/events';
    } else {
      this.horizonUrl = 'https://horizon-testnet.stellar.org/events';
    }

    this.eventEmitter = new EventEmitter();
    this.logger.log(`Horizon stream configured for ${this.horizonUrl}`);
  }

  /**
   * Start streaming events from Horizon.
   * @param cursor - Optional cursor to resume from (for reconnection)
   */
  startStreaming(cursor?: string): void {
    if (this.abortController && !this.abortController.signal.aborted) {
      this.logger.warn('Stream already running, stopping first');
      this.stopStreaming();
    }

    this.abortController = new AbortController();
    this.streamEvents(cursor);
  }

  /**
   * Stop streaming and clean up resources.
   */
  stopStreaming(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.state.connected = false;
    this.logger.log('Horizon stream stopped');
  }

  /**
   * Get current connection state.
   */
  getState(): Readonly<StreamState> {
    return { ...this.state };
  }

  /**
   * Subscribe to settlement events.
   * @param listener - Callback function for settlement events
   * @returns Unsubscribe function
   */
  onSettlementEvent(listener: (event: SettlementEvent) => void): () => void {
    this.eventEmitter.on('settlement', listener);
    return () => this.eventEmitter.off('settlement', listener);
  }

  /**
   * Subscribe to connection state changes.
   * @param listener - Callback for state changes
   * @returns Unsubscribe function
   */
  onConnectionChange(listener: (state: StreamState) => void): () => void {
    this.eventEmitter.on('connectionChange', listener);
    return () => this.eventEmitter.off('connectionChange', listener);
  }

  /**
   * Internal method to stream events with reconnection logic.
   */
  private async streamEvents(cursor?: string): Promise<void> {
    if (!this.abortController) return;

    const signal = this.abortController.signal;
    let url = this.horizonUrl;

    if (cursor) {
      url += `?cursor=${encodeURIComponent(cursor)}`;
    }

    this.logger.log(`Connecting to Horizon stream: ${url}`);

    try {
      const response = await fetch(url, {
        signal,
        headers: {
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      });

      if (!response.ok) {
        throw new Error(`Horizon stream failed: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('Horizon stream response has no body');
      }

      // Connection successful
      this.onConnectionEstablished();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        if (signal.aborted) {
          this.logger.log('Stream aborted by user');
          return;
        }

        const { done, value } = await reader.read();

        if (done) {
          this.logger.warn('Horizon stream closed by server');
          this.onConnectionLost();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (data) {
              this.handleEventData(data);
            }
          } else if (line.startsWith(':')) {
            // Comment/heartbeat
            this.logger.debug(`Horizon heartbeat: ${line}`);
          }
        }
      }
    } catch (error) {
      if (signal.aborted) {
        this.logger.log('Stream aborted during connection');
        return;
      }

      this.logger.error(`Horizon stream error: ${String(error)}`);
      this.onConnectionLost();

      // Schedule reconnection with exponential backoff
      if (this.config.autoReconnect && !signal.aborted) {
        this.scheduleReconnect();
      }
    }
  }

  /**
   * Handle incoming event data from Horizon.
   */
  private handleEventData(data: string): void {
    try {
      const event = JSON.parse(data);
      this.state.eventsReceived++;

      // Parse settlement event
      const settlementEvent = parseSettlementEvent({
        ledger: event.ledger ?? 0,
        contractId: event.contract_id ?? '',
        topics: event.topic ?? [],
        value: event.value ?? {},
      });

      if (settlementEvent) {
        this.logger.debug(
          `Settlement event received: invoice ${settlementEvent.invoiceId} at ledger ${settlementEvent.ledger}`
        );
        this.eventEmitter.emit('settlement', settlementEvent);
      }
    } catch (error) {
      this.logger.warn(`Failed to parse Horizon event: ${String(error)}`);
    }
  }

  /**
   * Handle successful connection.
   */
  private onConnectionEstablished(): void {
    this.state.connected = true;
    this.state.lastConnected = new Date();
    this.state.consecutiveFailures = 0;
    this.state.retryDelay = this.config.baseRetryDelay;

    this.logger.log('✅ Horizon stream connected');
    this.eventEmitter.emit('connectionChange', this.getState());
  }

  /**
   * Handle connection loss.
   */
  private onConnectionLost(): void {
    this.state.connected = false;
    this.state.consecutiveFailures++;

    this.logger.warn(
      `❌ Horizon stream disconnected (consecutive failures: ${this.state.consecutiveFailures})`
    );
    this.eventEmitter.emit('connectionChange', this.getState());

    // Alert if too many consecutive failures
    if (this.state.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      this.logger.error(
        `⚠️  Horizon stream has failed ${this.state.consecutiveFailures} times consecutively. ` +
        'Check Horizon endpoint and network connectivity.'
      );
    }
  }

  /**
   * Schedule reconnection with exponential backoff.
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.logger.log(
      `Reconnecting in ${this.state.retryDelay}ms (attempt ${this.state.consecutiveFailures})`
    );

    this.reconnectTimeout = setTimeout(() => {
      this.logger.log('Attempting to reconnect to Horizon stream...');
      this.streamEvents();
    }, this.state.retryDelay);

    // Exponential backoff with jitter
    this.state.retryDelay = Math.min(
      this.state.retryDelay * 2 + Math.random() * 1000,
      this.config.maxRetryDelay
    );
  }

  /**
   * Cleanup on module destroy.
   */
  onModuleDestroy(): void {
    this.stopStreaming();
    this.eventEmitter.removeAllListeners();
  }
}