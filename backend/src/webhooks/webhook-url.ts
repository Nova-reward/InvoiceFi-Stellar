import { BadRequestException } from '@nestjs/common';

/**
 * Reject webhook URLs that point at loopback, private, or link-local
 * addresses so a registered endpoint can't be used to reach internal
 * services or the cloud metadata endpoint (169.254.169.254) from inside our
 * network — a classic SSRF vector for any "call a URL the user gives you"
 * feature.
 *
 * This is a best-effort static check on the literal hostname: it does not
 * resolve DNS, so it does not protect against a hostname that resolves to a
 * private address at delivery time (DNS rebinding). That requires
 * resolve-then-pin at request time and is a reasonable follow-up, not a
 * blocker for this feature.
 */
export function assertPublicWebhookUrl(rawUrl: string): URL {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new BadRequestException('url is required');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BadRequestException('url must be a valid absolute URL');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new BadRequestException('url must use http or https');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isBlockedHostname(hostname)) {
    throw new BadRequestException(
      'url must not target a loopback, private, or link-local address',
    );
  }

  return parsed;
}

function isBlockedHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  if (hostname === '::1' || hostname === '0:0:0:0:0:0:0:1') return true;

  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1, 5).map(Number);
    if (octets.some((o) => o > 255)) return true; // malformed -> reject
    const [a, b] = octets;
    if (a === 0) return true; // "this network"
    if (a === 127) return true; // loopback
    if (a === 10) return true; // RFC1918 private
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918 private
    if (a === 192 && b === 168) return true; // RFC1918 private
    return false;
  }

  // Loose IPv6 private/unique-local/link-local range check.
  if (/^(fe80|fc00|fd)/i.test(hostname)) return true;

  return false;
}
