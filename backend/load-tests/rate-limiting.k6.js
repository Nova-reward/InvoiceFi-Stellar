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
 *   TEST_JWT_TOKENS                  – comma-separated valid JWTs, one per VU
 *
 * Acceptance criteria
 * -------------------
 *   For every tier the observed 429 rate must fall within ±5% of the
 *   theoretical rate predicted by (requests_per_vu - limit) / requests_per_vu.
 *   This is enforced via k6 thresholds on custom counters/rates.
 *
 * Run example
 * -----------
 *   k6 run --env BASE_URL=http://localhost:4000 --env VUS=2 \
 *     --env TEST_JWT_TOKENS=token-for-vu-1,token-for-vu-2 load-tests/rate-limiting.k6.js
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
const non429ErrorRate = new Rate('non_429_error');

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
const JWT_TOKENS = (__ENV.TEST_JWT_TOKENS || '').split(',').filter(Boolean);
const VUS = parseInt(__ENV.VUS || '50', 10);

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
  // One isolated burst per VU makes the observed ratio directly comparable
  // with (burst - limit) / burst instead of mixing later-window 429s into it.
  scenarios: {
    rate_limit_burst: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: 1,
      maxDuration: '10m',
    },
  },

  thresholds: {
    // ── Response latency ────────────────────────────────────────────────────
    http_req_duration: ['p(95)<500'],

    // ── Overall error rate (429s are expected) ──────────────────────────────
    non_429_error: ['rate<0.05'],

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
  // Each VU must use a valid, distinct token so user/wallet counters are
  // measured per identity instead of counting invalid requests as IP traffic.
  if (!JWT_TOKENS[__VU - 1]) {
    throw new Error('TEST_JWT_TOKENS must contain one valid JWT per VU');
  }
  const vuToken = JWT_TOKENS[__VU - 1];
  // Keep metric groups on distinct source addresses so deployments that
  // combine identity tiers do not cross-contaminate the burst measurements.
  const ipHeaders = { 'X-Forwarded-For': `198.51.100.${__VU}` };
  const authHeaders = {
    Authorization: `Bearer ${vuToken}`,
    'X-Forwarded-For': `203.0.113.${__VU}`,
  };
  const jsonHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${vuToken}`,
    'X-Forwarded-For': `192.0.2.${__VU}`,
  };

  // ── Tier 1: per-IP (unauthenticated) ──────────────────────────────────────
  group('IP tier – per-IP rate limit', () => {
    for (let i = 0; i < IP_BURST; i++) {
      const res = http.get(`${BASE_URL}/health`, { headers: ipHeaders });
      const is429 = res.status === 429;

      if (__ITER === 0) ip429Rate.add(is429);
      non429ErrorRate.add(res.status !== 200 && res.status !== 429);

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

      if (__ITER === 0) user429Rate.add(is429);
      non429ErrorRate.add(![200, 401].includes(res.status) && res.status !== 429);

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

      if (__ITER === 0) wallet429Rate.add(is429);
      non429ErrorRate.add(![200, 201, 400, 401].includes(res.status) && res.status !== 429);

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
      non429ErrorRate.add(![200, 201, 400, 401].includes(res.status) && res.status !== 429);

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
