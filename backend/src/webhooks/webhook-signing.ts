import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/** Header carrying the HMAC-SHA256 signature of the raw request body. */
export const WEBHOOK_SIGNATURE_HEADER = 'X-InvoiceFi-Signature';
/** Header carrying the invoice lifecycle event type of this delivery. */
export const WEBHOOK_EVENT_HEADER = 'X-InvoiceFi-Event';
/** Header carrying the delivery's id, stable across retries of the same delivery. */
export const WEBHOOK_DELIVERY_ID_HEADER = 'X-InvoiceFi-Delivery-Id';
/** Header carrying the ISO-8601 timestamp of this specific attempt. */
export const WEBHOOK_TIMESTAMP_HEADER = 'X-InvoiceFi-Timestamp';

/**
 * Sign a webhook request body with HMAC-SHA256, formatted as `sha256=<hex>`
 * (the same convention GitHub/Stripe use) so subscribers can dispatch on the
 * prefix if they ever need to support multiple algorithms.
 */
export function signWebhookPayload(secret: string, rawBody: string): string {
  const digest = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return `sha256=${digest}`;
}

/**
 * Constant-time verification of a signature header against a raw request
 * body. Not used by the delivery worker itself (which only signs outbound
 * requests) — exposed for subscriber-side integration tests and as the
 * reference implementation documented to webhook consumers.
 */
export function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | undefined | null,
): boolean {
  if (!signatureHeader) return false;
  const expected = Buffer.from(signWebhookPayload(secret, rawBody));
  const actual = Buffer.from(signatureHeader);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** Generate a new random HMAC signing secret for a subscription. */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}
