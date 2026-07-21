import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrityProof, loadSigningKey, signContent } from './signing';

/**
 * Holds the server's compliance signing key and produces integrity proofs for
 * export documents. The key is a Stellar/ed25519 secret configured via
 * `COMPLIANCE_SIGNING_SECRET`; when unset, a random key is generated for local
 * development and a warning is logged (signatures won't survive a restart).
 */
@Injectable()
export class ExportSigningService implements OnModuleInit {
  private readonly logger = new Logger(ExportSigningService.name);
  private keypair!: ReturnType<typeof loadSigningKey>['keypair'];

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const loaded = loadSigningKey(
      this.config.get<string>('COMPLIANCE_SIGNING_SECRET'),
    );
    this.keypair = loaded.keypair;
    if (loaded.ephemeral) {
      this.logger.warn(
        'COMPLIANCE_SIGNING_SECRET is not set — using an ephemeral signing ' +
          'key. Export signatures will not be reproducible across restarts. ' +
          'Configure a persistent key before production use.',
      );
    }
    this.logger.log(`Compliance signing key: ${this.keypair.publicKey()}`);
  }

  get signerPublicKey(): string {
    return this.keypair.publicKey();
  }

  /** Compute the SHA-256 digest and ed25519 signature of a document. */
  sign(content: Buffer | string): IntegrityProof {
    return signContent(this.keypair, content);
  }
}
