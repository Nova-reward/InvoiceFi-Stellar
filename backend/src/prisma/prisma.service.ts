import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { VaultService } from '../config/vault/vault.service';

/**
 * PrismaService
 *
 * Wraps PrismaClient with two enhancements:
 *
 * 1. **Vault-sourced credentials** — The DATABASE_URL is constructed from
 *    secrets fetched from HashiCorp Vault at startup, never from plain env vars.
 *
 * 2. **Zero-downtime credential rotation** — When Vault rotates the database
 *    password and revokes the old credentials, Postgres will reject the
 *    existing connection pool with an authentication error (error code 28P01).
 *    The `withRetry` wrapper detects this, asks VaultService to re-fetch the
 *    latest credentials, rebuilds PrismaClient with the new URL, and retries
 *    the operation — all transparently to callers.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /** Maximum reconnection attempts after a credential-rotation event. */
  private static readonly MAX_ROTATION_RETRIES = 3;

  /** Base delay (ms) for exponential back-off during reconnection. */
  private static readonly ROTATION_RETRY_BASE_MS = 500;

  private client: PrismaClient;

  constructor(private readonly vault: VaultService) {
    this.client = this.buildClient();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
    this.logger.log('Prisma connected to the database.');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
    this.logger.log('Prisma disconnected from the database.');
  }

  // ── Proxy — public Prisma surface ──────────────────────────────────────────

  /**
   * Returns the underlying PrismaClient.
   *
   * Usage: `this.prisma.client.invoice.findMany(…)`
   *
   * The client reference may change after a credential rotation. Always
   * access it through this getter — never cache the returned value.
   */
  get db(): PrismaClient {
    return this.client;
  }

  /**
   * Convenience wrappers so callers that previously received PrismaService
   * extended from PrismaClient can migrate with minimal churn.
   * Re-delegates to this.client, which is always the live client instance.
   */
  get invoice() {
    return this.client.invoice;
  }

  get syncCursor() {
    return this.client.syncCursor;
  }

  // Extend with additional model getters as the Prisma schema grows.
  // e.g.:  get user() { return this.client.user; }

  // ── Zero-downtime credential rotation ─────────────────────────────────────

  /**
   * Wraps a database operation with automatic retry on authentication failure.
   *
   * When Vault rotates credentials and the DB rejects the old password, this
   * method will:
   *   1. Ask VaultService to re-fetch the latest database credentials.
   *   2. Rebuild and reconnect PrismaClient with the new DATABASE_URL.
   *   3. Retry the original operation.
   *
   * @param operation  A callback that receives the current PrismaClient.
   */
  async withRetry<T>(
    operation: (client: PrismaClient) => Promise<T>,
  ): Promise<T> {
    let attempt = 0;

    while (true) {
      try {
        return await operation(this.client);
      } catch (err: unknown) {
        if (!this.isAuthError(err) || attempt >= PrismaService.MAX_ROTATION_RETRIES) {
          throw err;
        }

        attempt++;
        const delay =
          PrismaService.ROTATION_RETRY_BASE_MS * Math.pow(2, attempt - 1);

        this.logger.warn(
          `Database authentication error detected (attempt ${attempt}). ` +
            `Refreshing credentials from Vault in ${delay}ms…`,
        );

        await this.sleep(delay);
        await this.reconnectWithNewCredentials();
      }
    }
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private buildClient(): PrismaClient {
    const db = this.vault.database;
    const url =
      `postgresql://${db.username}:${encodeURIComponent(db.password)}` +
      `@${db.host}:${db.port}/${db.database}`;

    return new PrismaClient({ datasources: { db: { url } } });
  }

  private async reconnectWithNewCredentials(): Promise<void> {
    try {
      await this.client.$disconnect();
    } catch {
      // Ignore disconnect errors on a broken connection.
    }

    await this.vault.refreshDatabaseSecrets();
    this.client = this.buildClient();

    await this.client.$connect();
    this.logger.log('Prisma reconnected with rotated credentials.');
  }

  /**
   * Returns true for PostgreSQL and Prisma errors that indicate the credentials
   * were revoked (error code 28P01 = invalid_password).
   */
  private isAuthError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const msg = err.message.toLowerCase();
    // Postgres wire error code for authentication failure
    return (
      msg.includes('28p01') ||
      msg.includes('password authentication failed') ||
      msg.includes('authentication failed') ||
      // Prisma surfaces this as a P1000 error code
      msg.includes('p1000')
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
