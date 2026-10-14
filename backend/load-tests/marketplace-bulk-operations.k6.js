import http from 'k6/http';
import { check, group, sleep, Counter, Rate, Trend } from 'k6';
import { SharedArray } from 'k6/data';

// Configuration
export const options = {
  scenarios: {
    // Scenario 1: Bulk invoice creation (farmers)
    bulk_invoice_creation: {
      executor: 'per-vu-iterations',
      vus: 50,
      iterations: 200,
      exec: 'createInvoices',
      startTime: '0s',
    },
    // Scenario 2: Bulk invoice browsing (investors)
    bulk_invoice_browsing: {
      executor: 'per-vu-iterations',
      vus: 100,
      iterations: 500,
      exec: 'browseInvoices',
      startTime: '0s',
    },
    // Scenario 3: Bulk funding operations (investors)
    bulk_funding: {
      executor: 'per-vu-iterations',
      vus: 30,
      iterations: 150,
      exec: 'fundInvoices',
      startTime: '10s',
    },
    // Scenario 4: Bulk settlement (farmers)
    bulk_settlement: {
      executor: 'per-vu-iterations',
      vus: 20,
      iterations: 100,
      exec: 'settleInvoices',
      startTime: '20s',
    },
    // Scenario 5: Mixed realistic workload
    mixed_marketplace: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '1m', value: 50 },
        { duration: '3m', value: 50 },
        { duration: '1m', value: 100 },
        { duration: '3m', value: 100 },
        { duration: '1m', value: 0 },
      ],
      exec: 'mixedWorkload',
      startTime: '0s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<800', 'p(99)<1500'],
    http_req_failed: ['rate<0.05'],
    invoice_creation_duration: ['p(95)<1000'],
    invoice_funding_duration: ['p(95)<1200'],
    invoice_settlement_duration: ['p(95)<1500'],
    errors: ['rate<0.1'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';

// Shared data across VUs
const farmers = new SharedArray('farmers', function () {
  return Array.from({ length: 50 }, (_, i) => ({
    id: `farmer-${i}`,
    token: `Bearer farmer-token-${i}`,
    walletAddress: `G${Array(55).fill('A').join('')}${i}`,
  }));
});

const investors = new SharedArray('investors', function () {
  return Array.from({ length: 30 }, (_, i) => ({
    id: `investor-${i}`,
    token: `Bearer investor-token-${i}`,
    walletAddress: `G${Array(55).fill('B').join('')}${i}`,
    balance: 100000 + i * 10000,
  }));
});

// Metrics
const invoiceCreationDuration = new Trend('invoice_creation_duration');
const invoiceFundingDuration = new Trend('invoice_funding_duration');
const invoiceSettlementDuration = new Trend('invoice_settlement_duration');
const errorRate = new Rate('errors');
const invoicesCreated = new Counter('invoices_created');
const invoicesFunded = new Counter('invoices_funded');
const invoicesSettled = new Counter('invoices_settled');

// Helper functions
function generateInvoiceData(index) {
  const crops = ['wheat', 'corn', 'soybeans', 'rice', 'cotton'];
  const currencies = ['USDC', 'XLM', 'AQUA'];
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30 + Math.floor(Math.random() * 60));

  return {
    amount: Math.floor(Math.random() * 50000) + 1000,
    currency: currencies[Math.floor(Math.random() * currencies.length)],
    crop: crops[Math.floor(Math.random() * crops.length)],
    expiresAt: dueDate.toISOString(),
  };
}

function getRandomFarmer() {
  return farmers[Math.floor(Math.random() * farmers.length)];
}

function getRandomInvestor() {
  return investors[Math.floor(Math.random() * investors.length)];
}

// Scenario 1: Bulk invoice creation
export function createInvoices() {
  const farmer = getRandomFarmer();
  const invoiceData = generateInvoiceData(__ITER);

  group('Bulk Invoice Creation', () => {
    const startTime = new Date();
    
    const res = http.post(
      `${BASE_URL}/api/invoices`,
      JSON.stringify(invoiceData),
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: farmer.token,
        },
      },
    );

    const duration = new Date() - startTime;
    invoiceCreationDuration.add(duration);

    const success = check(res, {
      'invoice creation status is 201': (r) => r.status === 201,
      'invoice has id': (r) => r.json('id') !== undefined,
      'invoice has correct amount': (r) => r.json('amount') === invoiceData.amount,
      'invoice status is PENDING': (r) => r.json('status') === 'PENDING',
    });

    if (success) {
      invoicesCreated.add(1);
    } else {
      errorRate.add(1);
      console.error(`Failed to create invoice: ${res.status} - ${res.body}`);
    }
  });

  sleep(0.5 + Math.random() * 1.5);
}

// Scenario 2: Bulk invoice browsing
export function browseInvoices() {
  const user = Math.random() > 0.5 ? getRandomFarmer() : getRandomInvestor();

  group('Bulk Invoice Browsing', () => {
    // List all invoices
    const listRes = http.get(`${BASE_URL}/api/invoices`, {
      headers: {
        Authorization: user.token,
      },
    });

    check(listRes, {
      'list invoices status is 200': (r) => r.status === 200,
      'list returns array': (r) => Array.isArray(r.json()),
    });

    // If there are invoices, get details for random ones
    if (listRes.status === 200) {
      const invoices = listRes.json();
      if (invoices.length > 0) {
        const randomInvoice = invoices[Math.floor(Math.random() * invoices.length)];
        
        const detailRes = http.get(
          `${BASE_URL}/api/invoices/${randomInvoice.id}`,
          {
            headers: {
              Authorization: user.token,
            },
          },
        );

        check(detailRes, {
          'invoice detail status is 200': (r) => r.status === 200,
          'detail has correct id': (r) => r.json('id') === randomInvoice.id,
        });
      }
    }

    // Check pool stats
    const statsRes = http.get(`${BASE_URL}/pool/stats`);
    check(statsRes, {
      'pool stats status is 200': (r) => r.status === 200,
      'stats has totalLiquidity': (r) => r.json('totalLiquidity') !== undefined,
    });
  });

  sleep(0.2 + Math.random() * 0.8);
}

// Scenario 3: Bulk funding operations
export function fundInvoices() {
  const investor = getRandomInvestor();
  
  group('Bulk Invoice Funding', () => {
    // First, get list of PENDING invoices
    const listRes = http.get(`${BASE_URL}/api/invoices`, {
      headers: {
        Authorization: investor.token,
      },
    });

    if (listRes.status !== 200) {
      errorRate.add(1);
      return;
    }

    const invoices = listRes.json();
    const pendingInvoices = invoices.filter((inv) => inv.status === 'PENDING');

    if (pendingInvoices.length === 0) {
      sleep(1);
      return;
    }

    // Fund a random pending invoice
    const invoiceToFund = pendingInvoices[Math.floor(Math.random() * pendingInvoices.length)];
    const fundAmount = Math.min(
      invoiceToFund.amount * 0.8,
      investor.balance * 0.1,
    );

    const startTime = new Date();

    const fundRes = http.post(
      `${BASE_URL}/api/financing-pool/fund`,
      JSON.stringify({
        invoiceId: invoiceToFund.id,
        amount: fundAmount,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: investor.token,
        },
      },
    );

    const duration = new Date() - startTime;
    invoiceFundingDuration.add(duration);

    const success = check(fundRes, {
      'funding status is 201': (r) => r.status === 201,
      'funding has transaction hash': (r) => r.json('transactionHash') !== undefined,
      'funding amount is correct': (r) => r.json('amount') === fundAmount,
    });

    if (success) {
      invoicesFunded.add(1);
    } else if (fundRes.status !== 409 && fundRes.status !== 410) {
      errorRate.add(1);
      console.error(`Failed to fund invoice: ${fundRes.status} - ${fundRes.body}`);
    }
  });

  sleep(1 + Math.random() * 2);
}

// Scenario 4: Bulk settlement
export function settleInvoices() {
  const farmer = getRandomFarmer();
  
  group('Bulk Invoice Settlement', () => {
    // Get farmer's invoices
    const listRes = http.get(`${BASE_URL}/api/invoices`, {
      headers: {
        Authorization: farmer.token,
      },
    });

    if (listRes.status !== 200) {
      errorRate.add(1);
      return;
    }

    const invoices = listRes.json();
    const fundedInvoices = invoices.filter((inv) => inv.status === 'FUNDED');

    if (fundedInvoices.length === 0) {
      sleep(1);
      return;
    }

    // Settle a random funded invoice
    const invoiceToSettle = fundedInvoices[Math.floor(Math.random() * fundedInvoices.length)];

    const startTime = new Date();

    const settleRes = http.post(
      `${BASE_URL}/api/settlement/settle`,
      JSON.stringify({
        invoiceId: invoiceToSettle.id,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: farmer.token,
        },
      },
    );

    const duration = new Date() - startTime;
    invoiceSettlementDuration.add(duration);

    const success = check(settleRes, {
      'settlement status is 201': (r) => r.status === 201,
      'settlement has transaction hash': (r) => r.json('transactionHash') !== undefined,
      'settlement status is SETTLED': (r) => r.json('status') === 'SETTLED',
    });

    if (success) {
      invoicesSettled.add(1);
    } else if (settleRes.status !== 409) {
      errorRate.add(1);
      console.error(`Failed to settle invoice: ${settleRes.status} - ${settleRes.body}`);
    }
  });

  sleep(2 + Math.random() * 3);
}

// Scenario 5: Mixed realistic workload
export function mixedWorkload() {
  const rand = Math.random();
  
  if (rand < 0.3) {
    // 30% - Browse invoices
    browseInvoices();
  } else if (rand < 0.5) {
    // 20% - Create invoices
    createInvoices();
  } else if (rand < 0.75) {
    // 25% - Fund invoices
    fundInvoices();
  } else {
    // 25% - Settle invoices
    settleInvoices();
  }
}

// Health check at start
export function setup() {
  const res = http.get(`${BASE_URL}/health`);
  check(res, {
    'health check passed': (r) => r.status === 200,
  });
}

// Summary handler
export function handleSummary(data) {
  const summary = {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'summary.json': JSON.stringify(data, null, 2),
  };

  // Custom metrics summary
  const metrics = {
    invoices_created: invoicesCreated.value,
    invoices_funded: invoicesFunded.value,
    invoices_settled: invoicesSettled.value,
    avg_creation_time: invoiceCreationDuration.avg ? invoiceCreationDuration.avg.toFixed(2) : 0,
    avg_funding_time: invoiceFundingDuration.avg ? invoiceFundingDuration.avg.toFixed(2) : 0,
    avg_settlement_time: invoiceSettlementDuration.avg ? invoiceSettlementDuration.avg.toFixed(2) : 0,
    error_rate: errorRate.value ? (errorRate.value * 100).toFixed(2) : 0,
  };

  console.log('\n=== CUSTOM METRICS ===');
  console.log(JSON.stringify(metrics, null, 2));

  return summary;
}