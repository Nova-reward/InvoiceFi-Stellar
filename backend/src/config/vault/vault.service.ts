import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import * as https from 'https';
import * as http from 'http';
import {
  AppSecrets,
  AuthSecrets,
  DatabaseSecrets,
  SmtpSecrets,
  StellarSecrets,
  VaultKvResponse,
} from './vault.types';

/**
 * VaultService
 *
 * Authenticates with HashiCorp Vault and eagerly loads all application secrets
 * during the NestJS bootstrap phase (OnApplicationBootstrap).
 *
 * Authentication strategy (evaluated in order):
 *  1. AppRole  — VAULT_ROLE_ID + VAULT_SECRET_ID are both set (production).
 *  2. Token    — VAULT_TOKEN is set (local dev / CI).
 *
 * Secret paths (KV v2, mount: "secret"):
 *   secret/invoicefi/database
 *   secret/invoicefi/auth
 *   secret/invoicefi/smtp
 *   secret/invoicefi/stellar
 */
@Injectable()
export class VaultService implements OnApplicationBootstrap {
  private readonly logger = new Logger(VaultService.name);

  private readonly vaultAddr: string;
  private clientToken: string | null = null;
  private secrets: AppSecrets | null = null;

  constructor() {
    this.vaultAddr = this.requireEnv('VAULT_ADDR');
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async onApplicationBootstrap(): Promise<void> {
    this.logger.log(`Connecting to Vault at ${this.vaultAddr}`);
    await this.authenticate();
    this.secrets = await this.loadAllSecrets();
    this.logger.log('All secrets loaded from Vault successfully.');
  }

  // ── Public accessors ───────────────────────────────────────────────────────

  get database(): DatabaseSecrets {
    return this.requireSecrets().database;
  }

  get auth(): AuthSecrets {
    return this.requireSecrets().auth;
  }

  get smtp(): SmtpSecrets {
    return this.requireSecrets().smtp;
  }

  get stellar(): StellarSecrets {
    return this.requireSecrets().stellar;
  }

  /**
   * Re-fetches only the database credentials from Vault.
   * Called by PrismaService when it detects an authentication failure,
   * enabling zero-downtime credential rotation.
   */
  async refreshDatabaseSecrets(): Promise<DatabaseSecrets> {
    this.logger.warn('Refreshing database credentials from Vault.');
    const database = await this.readSecret<DatabaseSecrets>(
      'secret/data/invoicefi/database',
    );
    // Merge refreshed credentials into the cached secrets object.
    this.secrets = { ...this.requireSecrets(), database };
    this.logger.log('Database credentials refreshed.');
    return database;
  }

  // ── Authentication ─────────────────────────────────────────────────────────

  private async authenticate(): Promise<void> {
    const roleId = process.env['VAULT_ROLE_ID'];
    const secretId = process.env['VAULT_SECRET_ID'];

    if (roleId && secretId) {
      await this.authenticateWithAppRole(roleId, secretId);
    } else {
      this.authenticateWithToken();
    }
  }

  private async authenticateWithAppRole(
    roleId: string,
    secretId: string,
  ): Promise<void> {
    this.logger.log('Authenticating with Vault via AppRole.');
    const response = await this.vaultRequest<{ auth: { client_token: string } }>(
      'POST',
      '/v1/auth/approle/login',
      { role_id: roleId, secret_id: secretId },
    );
    this.clientToken = response.auth.client_token;
    this.logger.log('AppRole authentication successful.');
  }

  private authenticateWithToken(): void {
    const token = process.env['VAULT_TOKEN'];
    if (!token) {
      throw new Error(
        'Vault authentication failed: neither AppRole (VAULT_ROLE_ID + ' +
          'VAULT_SECRET_ID) nor a root token (VAULT_TOKEN) is configured.',
      );
    }
    this.clientToken = token;
    this.logger.warn(
      'Authenticating with Vault using VAULT_TOKEN. ' +
        'This is acceptable for local development only.',
    );
  }

  // ── Secret loading ─────────────────────────────────────────────────────────

  private async loadAllSecrets(): Promise<AppSecrets> {
    const [database, auth, smtp, stellar] = await Promise.all([
      this.readSecret<DatabaseSecrets>('secret/data/invoicefi/database'),
      this.readSecret<AuthSecrets>('secret/data/invoicefi/auth'),
      this.readSecret<SmtpSecrets>('secret/data/invoicefi/smtp'),
      this.readSecret<StellarSecrets>('secret/data/invoicefi/stellar'),
    ]);

    return { database, auth, smtp, stellar };
  }

  private async readSecret<T extends Record<string, string>>(
    path: string,
  ): Promise<T> {
    const response = await this.vaultRequest<VaultKvResponse<T>>(
      'GET',
      `/v1/${path}`,
    );
    return response.data.data;
  }

  // ── HTTP transport ─────────────────────────────────────────────────────────

  private vaultRequest<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const url = new URL(path, this.vaultAddr);
      const isHttps = url.protocol === 'https:';
      const transport: typeof https | typeof http = isHttps ? https : http;

      const payload = body !== undefined ? JSON.stringify(body) : undefined;

      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Vault-Token': this.clientToken ?? '',
          ...(payload !== undefined
            ? { 'Content-Length': Buffer.byteLength(payload) }
            : {}),
        },
      };

      const req = transport.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          const statusCode = res.statusCode ?? 0;

          if (statusCode < 200 || statusCode >= 300) {
            reject(
              new Error(
                `Vault request failed [${method} ${path}]: HTTP ${statusCode} — ${raw}`,
              ),
            );
            return;
          }

          try {
            resolve(JSON.parse(raw) as T);
          } catch {
            reject(
              new Error(
                `Vault response parse error [${method} ${path}]: ${raw}`,
              ),
            );
          }
        });
      });

      req.on('error', (err: Error) => {
        reject(
          new Error(`Vault connection error [${method} ${path}]: ${err.message}`),
        );
      });

      if (payload !== undefined) {
        req.write(payload);
      }
      req.end();
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private requireSecrets(): AppSecrets {
    if (this.secrets === null) {
      throw new Error(
        'VaultService: secrets have not been loaded yet. ' +
          'Ensure VaultModule is initialized before accessing secrets.',
      );
    }
    return this.secrets;
  }

  private requireEnv(key: string): string {
    const value = process.env[key];
    if (!value) {
      throw new Error(
        `Missing required environment variable: ${key}. ` +
          'Set it in your .env file or container environment.',
      );
    }
    return value;
  }
}
