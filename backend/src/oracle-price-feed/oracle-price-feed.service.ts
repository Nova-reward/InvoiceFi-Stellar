import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SorobanService } from '../soroban/soroban.service';

export interface PriceFeedConfig {
  feedId: string;
  name: string;
  assetPair: string;
  oracleContractId: string;
  submitterWallet: string;
  submitterSecretKey: string;
  updateIntervalMs: number;
  enabled: boolean;
}

export interface PriceUpdateResult {
  success: boolean;
  txHash?: string;
  error?: string;
  submittedPrice?: number;
  timestamp: Date;
}

@Injectable()
export class OraclePriceFeedService implements OnModuleInit {
  private readonly logger = new Logger(OraclePriceFeedService.name);
  private readonly feeds: PriceFeedConfig[] = [];
  private updateTimers: Map<string, ReturnType<typeof setInterval>> = new Map();

  constructor(
    private configService: ConfigService,
    private sorobanService: SorobanService,
  ) {}

  onModuleInit(): void {
    this.loadFeedConfigs();
    if (this.feeds.length === 0) {
      this.logger.warn('No oracle price feeds configured');
      return;
    }

    this.logger.log(`Initializing ${this.feeds.length} oracle price feed(s)`);

    for (const feed of this.feeds) {
      if (!feed.enabled) {
        this.logger.log(`Feed ${feed.feedId} is disabled, skipping`);
        continue;
      }

      // Start periodic price submission
      const timer = setInterval(() => {
        this.submitPriceUpdate(feed).catch((err) => {
          this.logger.error(`Failed to submit price for ${feed.feedId}: ${(err as Error).message}`);
        });
      }, feed.updateIntervalMs);

      this.updateTimers.set(feed.feedId, timer);

      // Submit initial price immediately
      this.submitPriceUpdate(feed).catch((err) => {
        this.logger.error(`Initial price submission failed for ${feed.feedId}: ${(err as Error).message}`);
      });
    }
  }

  onModuleDestroy(): void {
    for (const [feedId, timer] of this.updateTimers) {
      clearInterval(timer);
      this.logger.log(`Stopped price feed timer for ${feedId}`);
    }
    this.updateTimers.clear();
  }

  /**
   * Manually trigger a price update for a specific feed.
   */
  async triggerUpdate(feedId: string): Promise<PriceUpdateResult> {
    const feed = this.feeds.find((f) => f.feedId === feedId);
    if (!feed) {
      return {
        success: false,
        error: `Feed ${feedId} not found`,
        timestamp: new Date(),
      };
    }

    return this.submitPriceUpdate(feed);
  }

  /**
   * Get all configured feeds.
   */
  getFeeds(): PriceFeedConfig[] {
    return [...this.feeds];
  }

  /**
   * Get a specific feed configuration.
   */
  getFeed(feedId: string): PriceFeedConfig | undefined {
    return this.feeds.find((f) => f.feedId === feedId);
  }

  /**
   * Submit a price update to the oracle contract.
   */
  private async submitPriceUpdate(feed: PriceFeedConfig): Promise<PriceUpdateResult> {
    this.logger.debug(`Fetching price for ${feed.assetPair} from external source`);

    try {
      // Fetch the current market price from an external price source
      const marketPrice = await this.fetchMarketPrice(feed.assetPair);
      
      if (marketPrice === null || marketPrice <= 0) {
        return {
          success: false,
          error: `Invalid market price fetched: ${marketPrice}`,
          timestamp: new Date(),
        };
      }

      this.logger.log(`Submitting price for ${feed.assetPair}: ${marketPrice}`);

      // Submit the price to the oracle contract
      const result = await this.sorobanService.submitOraclePrice({
        oracleContractId: feed.oracleContractId,
        submitterWallet: feed.submitterWallet,
        assetPair: feed.assetPair,
        price: marketPrice,
        signature: '', // Signature is handled internally by the Soroban SDK
      });

      return {
        success: true,
        txHash: result.txHash,
        submittedPrice: marketPrice,
        timestamp: new Date(),
      };
    } catch (err) {
      const errorMessage = (err as Error).message;
      this.logger.error(`Price update failed for ${feed.feedId}: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Fetch the current market price from an external price source.
   * This is a placeholder - in production, this would call external APIs
   * like CoinGecko, Binance, or other market data providers.
   */
  private async fetchMarketPrice(assetPair: string): Promise<number | null> {
    // Example external price sources:
    // - CoinGecko API
    // - Binance API
    // - Kraken API
    // - Custom price feed API

    // For now, we'll simulate fetching from an external source
    // In production, replace this with actual API calls

    try {
      // Example: Fetch from CoinGecko
      // const [base, quote] = assetPair.split('/');
      // const response = await fetch(
      //   `https://api.coingecko.com/api/v3/simple/price?ids=${base.toLowerCase()}&vs_currencies=${quote.toLowerCase()}`
      // );
      // const data = await response.json();
      // return data[base.toLowerCase()]?.[quote.toLowerCase()] || null;

      // Simulated price for testing
      this.logger.debug(`Simulating price fetch for ${assetPair}`);
      return this.getSimulatedPrice(assetPair);
    } catch (err) {
      this.logger.warn(`Failed to fetch market price for ${assetPair}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Get a simulated price for testing purposes.
   * In production, this would be replaced by actual market data.
   */
  private getSimulatedPrice(assetPair: string): number {
    // Simulated prices for common pairs
    const simulatedPrices: Record<string, number> = {
      'XLM/USDC': 0.12,
      'USDC/AQUA': 1.05,
      'XLM/AQUA': 0.10,
    };

    const basePrice = simulatedPrices[assetPair] || 1.0;
    
    // Add small random variation (±0.1%) to simulate market movement
    const variation = 1 + (Math.random() - 0.5) * 0.002;
    
    return Math.floor(basePrice * variation * 10000); // Return in basis points
  }

  /**
   * Load feed configurations from environment variables.
   */
  private loadFeedConfigs(): void {
    const configsJson = this.configService.get<string>('ORACLE_PRICE_FEEDS', '[]');
    
    try {
      const configs = JSON.parse(configsJson) as Partial<PriceFeedConfig>[];
      
      for (const config of configs) {
        if (!config.feedId || !config.assetPair || !config.oracleContractId) {
          this.logger.warn(`Skipping invalid price feed config: ${JSON.stringify(config)}`);
          continue;
        }

        this.feeds.push({
          feedId: config.feedId,
          name: config.name || config.feedId,
          assetPair: config.assetPair,
          oracleContractId: config.oracleContractId,
          submitterWallet: config.submitterWallet || this.configService.get<string>('ORACLE_SUBMITTER_WALLET', ''),
          submitterSecretKey: config.submitterSecretKey || this.configService.get<string>('ORACLE_SUBMITTER_SECRET_KEY', ''),
          updateIntervalMs: config.updateIntervalMs || 60000, // Default: 1 minute
          enabled: config.enabled ?? true,
        });
      }
    } catch (err) {
      this.logger.error(`Failed to parse ORACLE_PRICE_FEEDS config: ${(err as Error).message}`);
    }
  }
}