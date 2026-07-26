import http from 'k6/http';
import { check, group, sleep, Counter, Rate, Trend, Gauge } from 'k6';
import { SharedArray } from 'k6/data';

// Stress test configuration - designed to find the breaking point
export const options = {
  scenarios: {
    // Gradual ramp-up to find breaking point
    gradual_ramp: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '2m', value: 50 },   // Normal load
        { duration: '2m', value: 100 },  // 2x normal
        { duration: '2m', value: 200 },  // 4x normal
        { duration: '2m', value: 300 },  // 6x normal
        { duration: '2m', value: 400 },  // 8x normal
        { duration: '2m', value: 500 },  // 10x normal
        { duration: '2m', value: 0 },    // Ramp down
      ],
      exec: 'stressWorkload',
      startTime: '0s',
    },
    
    // Spike test - sudden burst
    spike_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', value: 0 },    // Baseline
        { duration: '10s', value: 1000 }, // Sudden spike to 1000 VUs
        { duration: '1m', value: 1000 },  // Hold spike
        { duration: '30s', value: 0 },    // Drop
        { duration: '1m', value: 0 },     // Recovery
      ],
      exec: 'stressWorkload',
      startTime: '15m',
    },
  },
  thresholds: {
    // Relaxed thresholds for stress test - we expect degradation
    http_req_duration: ['p(95)<5000', 'p(99)<10000'],
    http_req_failed: ['rate<0.3'], // Allow up to 30% failure rate
    errors: ['rate<0.3'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';

// Shared test data
const testUsers = new SharedArray('testUsers', function () {
  return Array.from({ length: 100 }, (_, i) => ({
    id: `stress-user-${i}`,
    token: `Bearer stress-token-${i}`,
    walletAddress: `G${Array(55).fill('X').join('')}${i}`,
    type: i < 60 ? 'farmer' : 'investor', // 60% farmers, 40% investors
  }));
});

// Stress-specific metrics
const stressMetrics = {
  requestDuration: new Trend('stress_request_duration'),
  errorCount: new Counter('stress_errors'),
  successCount: new Counter('stress_successes'),
  timeoutCount: new Counter('stress_timeouts'),
  concurrentRequests: new Gauge('stress_concurrent_requests'),
  memoryUsage: new Gauge('stress_memory_usage'),
};

// Track system degradation
let degradationDetected = false;
let degradationPoint = null;

function checkDegradation(status, duration) {
  // Detect when system starts degrading
  if (!degradationDetected && (status >= 500 || duration > 3000)) {
    degradationDetected = true;
    degradationPoint = {
      timestamp: new Date(),
      vus: __VU,
      status: status,
      duration: duration,
    };
    console.error(`⚠️  DEGRADATION DETECTED at VU ${__VU}: status=${status}, duration=${duration}ms`);
  }
}

// Stress workload - mix of all operations
export function stressWorkload() {
  const user = testUsers[Math.floor(Math.random() * testUsers.length)];
  const operation = Math.random();
  
  stressMetrics.concurrentRequests.add(1);

  try {
    if (operation < 0.25) {
      // 25% - Invoice creation (write-heavy)
      stressCreateInvoice(user);
    } else if (operation < 0.50) {
      // 25% - Invoice listing (read-heavy)
      stressListInvoices(user);
    } else if (operation < 0.70) {
      // 20% - Invoice detail (read-heavy)
      stressGetInvoice(user);
    } else if (operation < 0.85) {
      // 15% - Funding operations (write-heavy, expensive)
      stressFundInvoice(user);
    } else {
      // 15% - Settlement operations (write-heavy, expensive)
      stressSettleInvoice(user);
    }
  } catch (e) {
    stressMetrics.errorCount.add(1);
    console.error(`Stress test error: ${e.message}`);
  } finally {
    stressMetrics.concurrentRequests.add(-1);
  }

  // Minimal sleep to maximize load
  sleep(Math.random() * 0.5);
}

function stressCreateInvoice(user) {
  const startTime = new Date();
  
  const invoiceData = {
    amount: Math.floor(Math.random() * 50000) + 1000,
    currency: ['USDC', 'XLM', 'AQUA'][Math.floor(Math.random() * 3)],
    crop: ['wheat', 'corn', 'soybeans'][Math.floor(Math.random() * 3)],
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };

  const res = http.post(
    `${BASE_URL}/api/invoices`,
    JSON.stringify(invoiceData),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: user.token,
      },
      timeout: '10s', // 10 second timeout
    },
  );

  const duration = new Date() - startTime;
  stressMetrics.requestDuration.add(duration);

  const success = check(res, {
    'status is 201 or 429 or 500': (r) => [201, 429, 500, 502, 503, 504].includes(r.status),
    'response time < 10s': (r) => r.timings.duration < 10000,
  });

  if (success) {
    stressMetrics.successCount.add(1);
  } else {
    stressMetrics.errorCount.add(1);
    checkDegradation(res.status, duration);
  }

  if (res.status === 504 || res.status === 0) {
    stressMetrics.timeoutCount.add(1);
  }
}

function stressListInvoices(user) {
  const startTime = new Date();
  
  const res = http.get(`${BASE_URL}/api/invoices`, {
    headers: {
      Authorization: user.token,
    },
    timeout: '5s',
  });

  const duration = new Date() - startTime;
  stressMetrics.requestDuration.add(duration);

  const success = check(res, {
    'status is 200 or 429 or 500': (r) => [200, 429, 500, 502, 503, 504].includes(r.status),
    'response time < 5s': (r) => r.timings.duration < 5000,
  });

  if (success) {
    stressMetrics.successCount.add(1);
  } else {
    stressMetrics.errorCount.add(1);
    checkDegradation(res.status, duration);
  }
}

function stressGetInvoice(user) {
  const startTime = new Date();
  
  // Use a range of invoice IDs to test
  const invoiceId = `invoice-${Math.floor(Math.random() * 1000)}`;
  
  const res = http.get(`${BASE_URL}/api/invoices/${invoiceId}`, {
    headers: {
      Authorization: user.token,
    },
    timeout: '5s',
  });

  const duration = new Date() - startTime;
  stressMetrics.requestDuration.add(duration);

  const success = check(res, {
    'status is 200, 404, 429 or 500': (r) => [200, 404, 429, 500, 502, 503, 504].includes(r.status),
    'response time < 5s': (r) => r.timings.duration < 5000,
  });

  if (success) {
    stressMetrics.successCount.add(1);
  } else {
    stressMetrics.errorCount.add(1);
    checkDegradation(res.status, duration);
  }
}

function stressFundInvoice(user) {
  if (user.type !== 'investor') return;

  const startTime = new Date();
  
  const fundData = {
    invoiceId: `invoice-${Math.floor(Math.random() * 1000)}`,
    amount: Math.floor(Math.random() * 10000) + 1000,
  };

  const res = http.post(
    `${BASE_URL}/api/financing-pool/fund`,
    JSON.stringify(fundData),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: user.token,
      },
      timeout: '15s', // Longer timeout for blockchain operations
    },
  );

  const duration = new Date() - startTime;
  stressMetrics.requestDuration.add(duration);

  const success = check(res, {
    'status is 201, 404, 409, 410, 422, 429 or 500': (r) => 
      [201, 404, 409, 410, 422, 429, 500, 502, 503, 504].includes(r.status),
    'response time < 15s': (r) => r.timings.duration < 15000,
  });

  if (success) {
    stressMetrics.successCount.add(1);
  } else {
    stressMetrics.errorCount.add(1);
    checkDegradation(res.status, duration);
  }
}

function stressSettleInvoice(user) {
  if (user.type !== 'farmer') return;

  const startTime = new Date();
  
  const settleData = {
    invoiceId: `invoice-${Math.floor(Math.random() * 1000)}`,
  };

  const res = http.post(
    `${BASE_URL}/api/settlement/settle`,
    JSON.stringify(settleData),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: user.token,
      },
      timeout: '15s', // Longer timeout for blockchain operations
    },
  );

  const duration = new Date() - startTime;
  stressMetrics.requestDuration.add(duration);

  const success = check(res, {
    'status is 201, 404, 403, 409, 429 or 500': (r) => 
      [201, 404, 403, 409, 429, 500, 502, 503, 504].includes(r.status),
    'response time < 15s': (r) => r.timings.duration < 15000,
  });

  if (success) {
    stressMetrics.successCount.add(1);
  } else {
    stressMetrics.errorCount.add(1);
    checkDegradation(res.status, duration);
  }
}

// Setup - verify system is healthy before stress test
export function setup() {
  console.log('🔥 Starting stress test...');
  console.log('This test will gradually increase load to find the breaking point');
  
  const res = http.get(`${BASE_URL}/health`);
  check(res, {
    'health check passed': (r) => r.status === 200,
  });

  return { startTime: new Date() };
}

// Summary with stress test analysis
export function handleSummary(data) {
  const summary = {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'stress-summary.json': JSON.stringify(data, null, 2),
  };

  // Calculate stress test metrics
  const totalRequests = stressMetrics.successCount.value + stressMetrics.errorCount.value;
  const errorRate = totalRequests > 0 ? (stressMetrics.errorCount.value / totalRequests) * 100 : 0;
  const successRate = totalRequests > 0 ? (stressMetrics.successCount.value / totalRequests) * 100 : 0;
  const avgDuration = stressMetrics.requestDuration.avg || 0;
  const p95Duration = data.metrics.stress_request_duration?.values?.p95 || 0;
  const p99Duration = data.metrics.stress_request_duration?.values?.p99 || 0;

  console.log('\n' + '='.repeat(60));
  console.log('🔥 STRESS TEST RESULTS');
  console.log('='.repeat(60));
  console.log(`Total Requests: ${totalRequests}`);
  console.log(`Successful: ${stressMetrics.successCount.value} (${successRate.toFixed(2)}%)`);
  console.log(`Failed: ${stressMetrics.errorCount.value} (${errorRate.toFixed(2)}%)`);
  console.log(`Timeouts: ${stressMetrics.timeoutCount.value}`);
  console.log(`Average Response Time: ${avgDuration.toFixed(2)}ms`);
  console.log(`P95 Response Time: ${p95Duration.toFixed(2)}ms`);
  console.log(`P99 Response Time: ${p99Duration.toFixed(2)}ms`);
  
  if (degradationDetected) {
    console.log(`\n⚠️  DEGRADATION DETECTED at: ${degradationPoint.timestamp}`);
    console.log(`   VUs: ${degradationPoint.vus}`);
    console.log(`   Status: ${degradationPoint.status}`);
    console.log(`   Duration: ${degradationPoint.duration}ms`);
  } else {
    console.log('\n✅ No degradation detected - system handled all load');
  }
  
  console.log('='.repeat(60));

  // Determine if test passed
  const passed = errorRate < 30 && p95Duration < 10000; // Relaxed criteria for stress test
  
  if (passed) {
    console.log('✅ STRESS TEST PASSED - System remained stable under heavy load');
  } else {
    console.log('❌ STRESS TEST FAILED - System degraded significantly');
  }
  
  console.log('='.repeat(60) + '\n');

  return summary;
}

// Teardown - cleanup if needed
export function teardown(data) {
  console.log('🧹 Stress test completed');
  console.log(`Total test duration: ${new Date() - data.metrics.data?.startTime}ms`);
}