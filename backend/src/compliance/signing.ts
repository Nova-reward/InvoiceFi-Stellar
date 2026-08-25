import { createHash } from 'crypto';
import { Keypair } from '@stellar/stellar-sdk';

/**
 * Cryptographic integrity primitives for regulatory exports.
 *
 * Exports are made audit-ready with two independent proofs over the exact
 * serialized document bytes:
 *   - a SHA-256 digest, so any downstream party can detect tampering; and
 *   - an ed25519 signature from the server's compliance key, so the origin is
 *     verifiable without trusting the transport.
 *
 * ed25519 is provided by the Stellar SDK's `Keypair` (already a dependency):
 * a Stellar secret seed (`S...`) is an ed25519 private key, and its public key
 * (`G...`) is a StrKey-encoded ed25519 public key. This lets any verifier with
 * the Stellar SDK check a signature with `Keypair.fromPublicKey(pk).verify(...)`,
 * and lets non-Stellar verifiers decode `G...` to the raw 32-byte ed25519 key.
 */

export const SIGNATURE_ALGORITHM = 'ed25519';
export const DIGEST_ALGORITHM = 'sha256';

export interface IntegrityProof {
  /** Digest algorithm used for `sha256` (always "sha256"). */
  digestAlgorithm: string;
  /** Hex-encoded SHA-256 of the signed content bytes. */
  sha256: string;
  /** Signature algorithm used (always "ed25519"). */
  signatureAlgorithm: string;
  /** Base64-encoded ed25519 signature over the signed content bytes. */
  signature: string;
  /** Stellar public key (G...) of the compliance signing key. */
  signerPublicKey: string;
}

function toBuffer(data: Buffer | string): Buffer {
  return typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
}

/** Hex-encoded SHA-256 digest of the given content. */
export function sha256Hex(data: Buffer | string): string {
  return createHash(DIGEST_ALGORITHM).update(toBuffer(data)).digest('hex');
}

/**
 * Produce a SHA-256 digest and an ed25519 signature over `data` using the
 * compliance signing key. The signature covers the raw content bytes, not the
 * digest, so verifiers may check either proof independently.
 */
export function signContent(
  keypair: Keypair,
  data: Buffer | string,
): IntegrityProof {
  const bytes = toBuffer(data);
  return {
    digestAlgorithm: DIGEST_ALGORITHM,
    sha256: sha256Hex(bytes),
    signatureAlgorithm: SIGNATURE_ALGORITHM,
    signature: keypair.sign(bytes).toString('base64'),
    signerPublicKey: keypair.publicKey(),
  };
}

/**
 * Verify an export's integrity proof against its content. Returns true only
 * when both the digest matches and the ed25519 signature is valid for the
 * given signer public key. Used by tests and available for tooling.
 */
export function verifyContent(
  signerPublicKey: string,
  data: Buffer | string,
  proof: Pick<IntegrityProof, 'sha256' | 'signature'>,
): boolean {
  const bytes = toBuffer(data);
  if (sha256Hex(bytes) !== proof.sha256) {
    return false;
  }
  try {
    return Keypair.fromPublicKey(signerPublicKey).verify(
      bytes,
      Buffer.from(proof.signature, 'base64'),
    );
  } catch {
    return false;
  }
}

export interface LoadedSigningKey {
  keypair: Keypair;
  /** True when no secret was configured and a random key was generated. */
  ephemeral: boolean;
}

/**
 * Resolve the compliance signing key. When `configuredSecret` is a valid
 * Stellar secret seed it is used directly; otherwise a random key is generated
 * and flagged `ephemeral` so the caller can warn that signatures will not be
 * reproducible across restarts (acceptable for local development only).
 */
export function loadSigningKey(configuredSecret?: string): LoadedSigningKey {
  const secret = configuredSecret?.trim();
  if (secret) {
    // Throws if malformed — surfacing a clear misconfiguration at startup.
    return { keypair: Keypair.fromSecret(secret), ephemeral: false };
  }
  return { keypair: Keypair.random(), ephemeral: true };
}
