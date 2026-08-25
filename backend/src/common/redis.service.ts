import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType;
  private logger = new Logger(RedisService.name);
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
}
