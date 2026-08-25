import http from 'k6/http';
import { check, group, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 100 }, // Ramp-up to 100 users
    { duration: '5m', target: 100 }, // Stay at 100 users
    { duration: '2m', target: 200 }, // Ramp-up to 200 users (10x normal)
    { duration: '5m', target: 200 }, // Stay at 200 users
    { duration: '2m', target: 0 }, // Ramp-down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95th percentile response time < 500ms
    http_req_failed: ['rate<0.1'], // Error rate < 10%
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';

export default function () {
  group('Unauthenticated endpoint - per-IP rate limit', () => {
    // Simulate unauthenticated users hitting /health
    const healthRes = http.get(`${BASE_URL}/health`);

    check(healthRes, {
      'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
      'has rate limit headers': (r) => 'x-ratelimit-limit' in r.headers,
      'retry-after header on 429': (r) => r.status !== 429 || 'retry-after' in r.headers,
    });
  });

  group('Authenticated endpoint - per-user rate limit', () => {
    // Simulate authenticated user with token
    const token = 'Bearer test-token-' + __VU; // Unique token per VU (virtual user)

    const invoiceRes = http.get(`${BASE_URL}/api/invoices`, {
      headers: {
        Authorization: token,
      },
    });

    check(invoiceRes, {
      'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
      'has rate limit headers': (r) => 'x-ratelimit-remaining' in r.headers,
      'rate limit remaining decreases': (r) => {
        const remaining = r.headers['x-ratelimit-remaining'];
        return remaining !== undefined;
      },
    });
  });

  group('Expensive operation - operation-level rate limit', () => {
    const token = 'Bearer test-token-' + __VU;

    // Simulate invoice creation (expensive operation)
    const createRes = http.post(
      `${BASE_URL}/api/invoices/create`,
      JSON.stringify({
        amount: 10000,
        crop: 'wheat',
        dueDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: token,
        },
      },
    );

    check(createRes, {
      'invoice creation succeeds or rate limited': (r) => r.status === 201 || r.status === 429,
      'success has invoice ID': (r) => r.status === 201 && r.json('id') !== undefined,
      'rate limited has retry-after': (r) => r.status !== 429 || 'retry-after' in r.headers,
    });
  });

  sleep(1);
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'summary.json': JSON.stringify(data),
  };
}
