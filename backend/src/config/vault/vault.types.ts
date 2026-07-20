/**
 * Strongly-typed shape of every secret path the application fetches from Vault.
 * All fields are readonly — secrets must not be mutated after load.
 */

export interface DatabaseSecrets {
  readonly username: string;
  readonly password: string;
  readonly database: string;
  readonly host: string;
  readonly port: string;
}

export interface AuthSecrets {
  readonly jwt_secret: string;
}

export interface SmtpSecrets {
  readonly host: string;
  readonly port: string;
  readonly secure: string;
  readonly user: string;
  readonly password: string;
  readonly from: string;
}

export interface StellarSecrets {
  readonly network_passphrase: string;
  readonly rpc_url: string;
  readonly horizon_url: string;
}

/** Aggregated view of all application secrets loaded from Vault. */
export interface AppSecrets {
  readonly database: DatabaseSecrets;
  readonly auth: AuthSecrets;
  readonly smtp: SmtpSecrets;
  readonly stellar: StellarSecrets;
}

/** Vault KV v2 response envelope for a single secret. */
export interface VaultKvResponse<T extends Record<string, string>> {
  data: {
    data: T;
    metadata: {
      version: number;
      created_time: string;
      deletion_time: string;
      destroyed: boolean;
    };
  };
}
