/**
 * rate-limiting.k6.js
 *
 * Load test for the Redis sliding-window rate-limit middleware.
 *
 * Environment variables
 * ---------------------
 *   BASE_URL                         – target base URL (default: http://localhost:4000)
 *   RATE_LIMIT_IP_REQUESTS           – IP tier max requests per window (default: 100)
 *   RATE_LIMIT_USER_REQUESTS         – user tier max requests per window (default: 1000)
 *   RATE_LIMIT_WALLET_REQUESTS       – wallet tier max requests per window (default: 30)
 *   RATE_LIMIT_WINDOW_MS             – shared window size in ms (default: 60000)
 *
 * Acceptance criteria
 * -------------------
 *   For every tier the observed 429 rate must fall within ±5% of the
 *   theoretical rate predicted by (requests_per_vu - limit) / requests_per_vu.
 *   This is enforced via k6 thresholds on custom counters/rates.
 *
 * Run example
 * -----------
 *   k6 run --env BASE_URL=http://localhost:4000 load-tests/rate-limiting.k6.js
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------

/** Number of requests that received a 429 response per tier. */
const ip429Rate = new Rate('ip_rate_limited');
const user429Rate = new Rate('user_rate_limited');
const wallet429Rate = new Rate('wallet_rate_limited');

/** Sanity counter to confirm header presence. */
const missingHeaderCount = new Counter('missing_ratelimit_headers');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';

/**
 * Requests each VU sends per iteration for each endpoint group.
 * Keep these well above the per-window limit so rate-limiting is reliably
 * triggered and the 429 ratio is measurable.
 */
const IP_LIMIT = parseInt(__ENV.RATE_LIMIT_IP_REQUESTS || '100', 10);
const USER_LIMIT = parseInt(__ENV.RATE_LIMIT_USER_REQUESTS || '1000', 10);
const WALLET_LIMIT = parseInt(__ENV.RATE_LIMIT_WALLET_REQUESTS || '30', 10);

/**
 * How many rapid-fire requests to send in the burst phase.
 * Set to 1.5× the tier limit so we definitely cross the threshold
 * and can measure a stable 429 ratio.
 */
const IP_BURST = Math.ceil(IP_LIMIT * 1.5);
const USER_BURST = Math.ceil(USER_LIMIT * 1.5);
const WALLET_BURST = Math.ceil(WALLET_LIMIT * 1.5);

/**
 * Theoretical 429 rate = (burst - limit) / burst
 * Thresholds allow ±5% tolerance on top of that.
 */
const ipTheoretical = (IP_BURST - IP_LIMIT) / IP_BURST;
const userTheoretical = (USER_BURST - USER_LIMIT) / USER_BURST;
const walletTheoretical = (WALLET_BURST - WALLET_LIMIT) / WALLET_BURST;

// ---------------------------------------------------------------------------
// k6 options
// ---------------------------------------------------------------------------

export const options = {
  stages: [
    { duration: '1m', target: 50 },  // ramp up
    { duration: '3m', target: 50 },  // steady state – validate rate limits
    { duration: '1m', target: 100 }, // ramp up to 2× for stress
    { duration: '3m', target: 100 }, // hold – confirm limits still hold
    { duration: '1m', target: 0 },   // ramp down
  ],

  thresholds: {
    // ── Response latency ────────────────────────────────────────────────────
    http_req_duration: ['p(95)<500'],

    // ── Overall error rate (non-429 errors only) ────────────────────────────
    // 429s are expected and excluded via the per-tier rate metrics below.
    http_req_failed: ['rate<0.05'],

    // ── IP tier: 429 rate must be within ±5% of theoretical ─────────────────
    // Lower bound: rate must not be TOO LOW (would indicate the limit isn't
    // being enforced).  Upper bound: rate must not be TOO HIGH (would indicate
    // the limit threshold is wrong).
    ip_rate_limited: [
      `rate>=${Math.max(0, ipTheoretical - 0.05).toFixed(4)}`,
      `rate<=${Math.min(1, ipTheoretical + 0.05).toFixed(4)}`,
    ],

    // ── User tier ────────────────────────────────────────────────────────────
    user_rate_limited: [
      `rate>=${Math.max(0, userTheoretical - 0.05).toFixed(4)}`,
      `rate<=${Math.min(1, userTheoretical + 0.05).toFixed(4)}`,
    ],

    // ── Wallet tier ──────────────────────────────────────────────────────────
    wallet_rate_limited: [
      `rate>=${Math.max(0, walletTheoretical - 0.05).toFixed(4)}`,
      `rate<=${Math.min(1, walletTheoretical + 0.05).toFixed(4)}`,
    ],

    // ── Header hygiene ────────────────────────────────────────────────────────
    missing_ratelimit_headers: ['count==0'],
  },
};

// ---------------------------------------------------------------------------
// Default function (one iteration per VU)
// ---------------------------------------------------------------------------

export default function () {
  // Each VU uses a unique token so user/wallet counters are per-identity,
  // matching how the middleware keys on userId / walletAddress.
  const vuToken = `test-token-${__VU}`;
  const authHeaders = { Authorization: `Bearer ${vuToken}` };
  const jsonHeaders = { 'Content-Type': 'application/json', ...authHeaders };

  // ── Tier 1: per-IP (unauthenticated) ──────────────────────────────────────
  group('IP tier – per-IP rate limit', () => {
    for (let i = 0; i < IP_BURST; i++) {
      const res = http.get(`${BASE_URL}/health`);
      const is429 = res.status === 429;

      ip429Rate.add(is429);

      check(res, {
        'IP tier: status is 200 or 429': (r) => r.status === 200 || r.status === 429,
        'IP tier: X-RateLimit-Ip-Limit header present': (r) =>
          'x-ratelimit-ip-limit' in r.headers,
        'IP tier: Retry-After present on 429': (r) =>
          r.status !== 429 || 'retry-after' in r.headers,
        'IP tier: X-RateLimit-Tier is IP on 429': (r) =>
          r.status !== 429 ||
          (r.headers['x-ratelimit-tier'] || '').toLowerCase() === 'ip',
      });

      if (!('x-ratelimit-ip-limit' in res.headers) && res.status !== 429) {
        missingHeaderCount.add(1);
      }
    }
  });

  // ── Tier 2: per-user (authenticated) ──────────────────────────────────────
  group('User tier – per-user rate limit', () => {
    for (let i = 0; i < USER_BURST; i++) {
      const res = http.get(`${BASE_URL}/api/invoices`, { headers: authHeaders });
      const is429 = res.status === 429;

      user429Rate.add(is429);

      check(res, {
        'User tier: status is 200, 401, or 429': (r) =>
          r.status === 200 || r.status === 401 || r.status === 429,
        'User tier: X-RateLimit-User-Limit header present on non-429': (r) =>
          r.status === 429 || 'x-ratelimit-user-limit' in r.headers,
        'User tier: Retry-After present on 429': (r) =>
          r.status !== 429 || 'retry-after' in r.headers,
        'User tier: retryAfter is positive number': (r) => {
          if (r.status !== 429) return true;
          const val = parseInt(r.headers['retry-after'] || '0', 10);
          return val > 0;
        },
      });
    }
  });

  // ── Tier 3: per-wallet (Soroban-mutating endpoints) ───────────────────────
  group('Wallet tier – per-wallet rate limit on financing-pool/fund', () => {
    const payload = JSON.stringify({ amount: '1000', token: 'USDC' });

    for (let i = 0; i < WALLET_BURST; i++) {
      const res = http.post(
        `${BASE_URL}/api/financing-pool/fund`,
        payload,
        { headers: jsonHeaders },
      );
      const is429 = res.status === 429;

      wallet429Rate.add(is429);

      check(res, {
        'Wallet tier: status is 200, 201, 400, 401, or 429': (r) =>
          [200, 201, 400, 401, 429].includes(r.status),
        'Wallet tier: X-RateLimit-Wallet-Limit header present': (r) =>
          'x-ratelimit-wallet-limit' in r.headers,
        'Wallet tier: Retry-After present on 429': (r) =>
          r.status !== 429 || 'retry-after' in r.headers,
        'Wallet tier: X-RateLimit-Tier is wallet on 429': (r) =>
          r.status !== 429 ||
          (r.headers['x-ratelimit-tier'] || '').toLowerCase() === 'wallet',
      });

      if (!('x-ratelimit-wallet-limit' in res.headers) && res.status === 200) {
        missingHeaderCount.add(1);
      }
    }
  });

  group('Wallet tier – per-wallet rate limit on settlement/settle', () => {
    const payload = JSON.stringify({ invoiceId: `invoice-${__VU}` });

    for (let i = 0; i < WALLET_BURST; i++) {
      const res = http.post(
        `${BASE_URL}/api/settlement/settle`,
        payload,
        { headers: jsonHeaders },
      );

      check(res, {
        'Settlement wallet tier: status is 200, 201, 400, 401, or 429': (r) =>
          [200, 201, 400, 401, 429].includes(r.status),
        'Settlement wallet tier: Retry-After present on 429': (r) =>
          r.status !== 429 || 'retry-after' in r.headers,
      });
    }
  });

  // Short pause so VUs do not run in a tight infinite loop between iterations.
  sleep(1);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export function handleSummary(data) {
  // Compute and log how far the observed 429 rates are from theoretical.
  const ipObs = data.metrics['ip_rate_limited']?.values?.rate ?? 0;
  const userObs = data.metrics['user_rate_limited']?.values?.rate ?? 0;
  const walletObs = data.metrics['wallet_rate_limited']?.values?.rate ?? 0;

  const fmt = (obs, theo) => {
    const diff = ((obs - theo) * 100).toFixed(1);
    const sign = diff >= 0 ? '+' : '';
    return `observed=${(obs * 100).toFixed(1)}% theoretical=${(theo * 100).toFixed(1)}% (${sign}${diff}pp)`;
  };

  console.log('');
  console.log('── Rate-limit 429 accuracy ──────────────────────────────────────');
  console.log(`  IP tier:     ${fmt(ipObs, ipTheoretical)}`);
  console.log(`  User tier:   ${fmt(userObs, userTheoretical)}`);
  console.log(`  Wallet tier: ${fmt(walletObs, walletTheoretical)}`);
  console.log('─────────────────────────────────────────────────────────────────');
  console.log('');

  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'load-tests/summary.json': JSON.stringify(data),
  };
}
