import { Injectable, OnModuleInit, OnModuleDestroy, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

export interface IdempotencyRecord {
  response: any;
  statusCode: number;
  userId: string;
  /** SHA-256 hex of the original request body — detects key reuse with a different payload. */
  bodyHash: string;
  createdAt: number;
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType;
  private readonly logger = new Logger(RedisService.name);
  private isConnected = false;

  constructor(private config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.get('REDIS_URL') || 'redis://localhost:6379';
    this.client = createClient({ url: redisUrl });
    this.client.on('error', (err) => this.logger.error('Redis error', err));
    this.client.on('connect', () => {
      this.isConnected = true;
      this.logger.log('Redis connected');
    });
    this.client.on('disconnect', () => {
      this.isConnected = false;
      this.logger.log('Redis disconnected');
    });
    await this.client.connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) await this.client.quit();
  }

  getClient(): RedisClientType {
    if (!this.isConnected) {
      this.logger.warn('Redis client not connected; operations may fail');
    }
    return this.client;
  }

  /**
   * Get a value from Redis
   */
  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  /**
   * Set a value in Redis with optional TTL
   */
  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await this.client.setEx(key, ttlSeconds, serialized);
    } else {
      await this.client.set(key, serialized);
    }
  }

  /**
   * Set if not exists (for idempotency)
   */
  async setIfNotExists(key: string, value: any, ttlSeconds: number): Promise<boolean> {
    const serialized = JSON.stringify(value);
    const result = await this.client.set(key, serialized, {
      EX: ttlSeconds,
      NX: true,
    });
    return result === 'OK';
  }

  /**
   * Delete a key
   */
  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  /**
   * Check if a key exists
   */
  async exists(key: string): Promise<boolean> {
    const result = await this.client.get(key);
    return result !== null;
  }

  /**
   * Get TTL for a key
   */
  async getTTL(key: string): Promise<number> {
    return this.client.ttl(key);
  }
}