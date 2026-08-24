import { createHmac } from 'crypto';
import { generateWebhookSecret, signWebhookPayload, verifyWebhookSignature } from './webhook-signing';

describe('webhook-signing', () => {
  describe('signWebhookPayload', () => {
    it('produces sha256=<hex hmac> of the raw body', () => {
      const secret = 'top-secret';
      const body = JSON.stringify({ invoiceId: '7', event: 'repaid' });

      const signature = signWebhookPayload(secret, body);

      const expectedDigest = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
      expect(signature).toBe(`sha256=${expectedDigest}`);
    });

    it('is deterministic for the same secret and body', () => {
      const a = signWebhookPayload('s', 'body');
      const b = signWebhookPayload('s', 'body');
      expect(a).toBe(b);
    });

    it('changes when the body changes', () => {
      const a = signWebhookPayload('s', 'body-a');
      const b = signWebhookPayload('s', 'body-b');
      expect(a).not.toBe(b);
    });

    it('changes when the secret changes', () => {
      const a = signWebhookPayload('secret-a', 'body');
      const b = signWebhookPayload('secret-b', 'body');
      expect(a).not.toBe(b);
    });
  });

  describe('verifyWebhookSignature', () => {
    it('accepts a correctly signed body', () => {
      const secret = 'top-secret';
      const body = '{"a":1}';
      const signature = signWebhookPayload(secret, body);

      expect(verifyWebhookSignature(secret, body, signature)).toBe(true);
    });

    it('rejects a tampered body', () => {
      const secret = 'top-secret';
      const signature = signWebhookPayload(secret, '{"a":1}');

      expect(verifyWebhookSignature(secret, '{"a":2}', signature)).toBe(false);
    });

    it('rejects the wrong secret', () => {
      const body = '{"a":1}';
      const signature = signWebhookPayload('secret-a', body);

      expect(verifyWebhookSignature('secret-b', body, signature)).toBe(false);
    });

    it('rejects a missing signature header', () => {
      expect(verifyWebhookSignature('s', 'body', undefined)).toBe(false);
      expect(verifyWebhookSignature('s', 'body', null)).toBe(false);
      expect(verifyWebhookSignature('s', 'body', '')).toBe(false);
    });

    it('rejects a malformed signature header without throwing', () => {
      expect(verifyWebhookSignature('s', 'body', 'not-a-real-signature')).toBe(false);
    });
  });

  describe('generateWebhookSecret', () => {
    it('generates a 64-char hex string (32 random bytes)', () => {
      const secret = generateWebhookSecret();
      expect(secret).toMatch(/^[0-9a-f]{64}$/);
    });

    it('generates distinct secrets across calls', () => {
      expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
    });
  });
});
