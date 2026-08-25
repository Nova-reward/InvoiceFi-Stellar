import { Keypair } from '@stellar/stellar-sdk';
import {
  loadSigningKey,
  sha256Hex,
  signContent,
  verifyContent,
} from './signing';

describe('signing', () => {
  it('computes a known SHA-256 digest', () => {
    // Well-known vector: SHA-256("hello").
    expect(sha256Hex('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('produces the same digest for string and buffer input', () => {
    expect(sha256Hex('invoice')).toBe(sha256Hex(Buffer.from('invoice', 'utf8')));
  });

  it('signs content and verifies the proof round-trip', () => {
    const keypair = Keypair.random();
    const content = '{"records":[]}';

    const proof = signContent(keypair, content);

    expect(proof.digestAlgorithm).toBe('sha256');
    expect(proof.signatureAlgorithm).toBe('ed25519');
    expect(proof.sha256).toBe(sha256Hex(content));
    expect(proof.signerPublicKey).toBe(keypair.publicKey());
    expect(verifyContent(proof.signerPublicKey, content, proof)).toBe(true);
  });

  it('rejects a proof when the content is tampered with', () => {
    const keypair = Keypair.random();
    const proof = signContent(keypair, 'original');

    expect(verifyContent(proof.signerPublicKey, 'tampered', proof)).toBe(false);
  });

  it('rejects a proof signed by a different key', () => {
    const signer = Keypair.random();
    const other = Keypair.random();
    const proof = signContent(signer, 'data');

    expect(verifyContent(other.publicKey(), 'data', proof)).toBe(false);
  });

  it('uses a configured secret when provided', () => {
    const secret = Keypair.random().secret();
    const loaded = loadSigningKey(secret);

    expect(loaded.ephemeral).toBe(false);
    expect(loaded.keypair.secret()).toBe(secret);
  });

  it('generates an ephemeral key when no secret is configured', () => {
    expect(loadSigningKey(undefined).ephemeral).toBe(true);
    expect(loadSigningKey('   ').ephemeral).toBe(true);
  });
});
