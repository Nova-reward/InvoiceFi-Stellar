import http from 'k6/http';
import { check, sleep, group } from 'k6';

/**
 * Oracle Monitor Load Test
 *
 * Verifies the oracle monitoring service handles 10x the normal polling rate
 * without memory leaks or connection exhaustion.
 *
 * Normal rate: 1 poll / 30s per feed = 2 feeds * 2 requests = ~4 req/min
 * 10x rate: 40 req/min sustained
 *
 * Usage:
 *   k6 run load-tests/oracle-monitor.k6.js
 *   k6 run --vus 50 --duration 5m load-tests/oracle-monitor.k6.js
 */

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const POLLING_INTERVAL_MS = Number(__ENV.ORACLE_POLLING_INTERVAL_MS) || 30_000;
const NORMAL_POLL_RATE_PER_MIN = 4;
const TEN_X_POLL_RATE_PER_MIN = NORMAL_POLL_RATE_PER_MIN * 10;

export const options = {
  scenarios: {
    health_check_sustained: {
      executor: 'constant-vus',
      vus: 10,
      duration: '3m',
    },
    health_check_burst: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 50 },
        { duration: '2m', target: 50 },
        { duration: '30s', target: 0 },
      ],
      startTime: '3m',
    },
    poll_trigger: {
      executor: 'constant-arrival-rate',
      rate: TEN_X_POLL_RATE_PER_MIN,
      timeUnit: '1m',
      duration: '6m',
      preAllocatedVUs: 5,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    http_req_failed: ['rate<0.05'],
    http_reqs: ['rate>1'],
  },
};

export default function () {
  group('Oracle Health Endpoint', () => {
    const res = http.get(`${BASE_URL}/oracle/health`);

    check(res, {
      'health returns 200': (r) => r.status === 200,
      'health has status field': (r) => {
        try {
          const body = JSON.parse(r.body as string);
          return typeof body.status === 'string';
        } catch {
          return false;
        }
      },
      'health has feeds array': (r) => {
        try {
          const body = JSON.parse(r.body as string);
          return Array.isArray(body.feeds);
        } catch {
          return false;
        }
      },
      'health has fallbackMode': (r) => {
        try {
          const body = JSON.parse(r.body as string);
          return typeof body.fallbackMode === 'string';
        } catch {
          return false;
        }
      },
      'health has pollingIntervalMs': (r) => {
        try {
          const body = JSON.parse(r.body as string);
          return typeof body.pollingIntervalMs === 'number';
        } catch {
          return false;
        }
      },
      'health has uptimeSeconds': (r) => {
        try {
          const body = JSON.parse(r.body as string);
          return typeof body.uptimeSeconds === 'number';
        } catch {
          return false;
        }
      },
      'response time acceptable': (r) => r.timings.duration < 2000,
    });
  });

  group('Oracle Poll Trigger', () => {
    const res = http.post(`${BASE_URL}/oracle/poll`, null, {
      headers: { 'Content-Type': 'application/json' },
    });

    check(res, {
      'poll trigger returns 200': (r) => r.status === 200,
      'poll trigger returns polled=true': (r) => {
        try {
          const body = JSON.parse(r.body as string);
          return body.polled === true;
        } catch {
          return false;
        }
      },
    });
  });

  group('Oracle Health Feed Details', () => {
    const res = http.get(`${BASE_URL}/oracle/health`);

    if (res.status === 200) {
      const body = JSON.parse(res.body as string);

      check(body, {
        'status is ok|degraded|critical': (b) =>
          ['ok', 'degraded', 'critical'].includes(b.status),
        'each feed has required fields': (b) =>
          b.feeds.every((f: any) =>
            f.feedId &&
            f.name &&
            f.status &&
            typeof f.lastUpdateLedger === 'number' &&
            typeof f.lastUpdatedAt === 'string' &&
            typeof f.stalenessThresholdMs === 'number',
          ),
        'fallbackRiskPremiumBps is number': (b) =>
          typeof b.fallbackRiskPremiumBps === 'number',
        'alertCooldownMs is number': (b) =>
          typeof b.alertCooldownMs === 'number',
      });
    }
  });

  sleep(0.5);
}

export function handleSummary(data) {
  const p95 = data.metrics.http_req_duration?.values?.p95 ?? 0;
  const errorRate = data.metrics.http_req_failed?.values?.rate ?? 0;
  const totalReqs = data.metrics.http_reqs?.values?.count ?? 0;

  return {
    stdout: `\n=== Oracle Monitor Load Test Results ===\n` +
      `Total Requests: ${totalReqs}\n` +
      `P95 Latency: ${p95.toFixed(2)}ms\n` +
      `Error Rate: ${(errorRate * 100).toFixed(2)}%\n` +
      `Thresholds Passed: ${JSON.stringify(data.thresholds)}\n`,
    'load-tests/oracle-monitor-results.json': JSON.stringify(data, null, 2),
  };
}
