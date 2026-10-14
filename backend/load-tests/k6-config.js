// k6 configuration for different test environments
export const environments = {
  // Local development environment
  local: {
    BASE_URL: 'http://localhost:4000',
    VUS: 10,
    DURATION: '1m',
    THRESHOLDS: {
      'http_req_duration': ['p(95)<1000', 'p(99)<2000'],
      'http_req_failed': ['rate<0.1'],
    },
  },

  // Staging environment
  staging: {
    BASE_URL: 'https://staging-api.invoicefi.com',
    VUS: 50,
    DURATION: '5m',
    THRESHOLDS: {
      'http_req_duration': ['p(95)<800', 'p(99)<1500'],
      'http_req_failed': ['rate<0.05'],
    },
  },

  // Production-like load test
  production: {
    BASE_URL: 'https://api.invoicefi.com',
    VUS: 100,
    DURATION: '10m',
    THRESHOLDS: {
      'http_req_duration': ['p(95)<500', 'p(99)<1000'],
      'http_req_failed': ['rate<0.01'],
    },
  },

  // Stress test (find breaking point)
  stress: {
    BASE_URL: 'http://localhost:4000',
    VUS: 200,
    DURATION: '15m',
    THRESHOLDS: {
      'http_req_duration': ['p(95)<2000', 'p(99)<5000'],
      'http_req_failed': ['rate<0.2'],
    },
  },

  // Soak test (long-running stability)
  soak: {
    BASE_URL: 'http://localhost:4000',
    VUS: 50,
    DURATION: '1h',
    THRESHOLDS: {
      'http_req_duration': ['p(95)<1000', 'p(99)<2000'],
      'http_req_failed': ['rate<0.05'],
    },
  },
};

// Test scenario configurations
export const scenarios = {
  // Quick smoke test
  smoke: {
    name: 'Smoke Test',
    description: 'Quick test to verify basic functionality',
    duration: '2m',
    vus: 10,
    iterations: 50,
  },

  // Load test - normal expected traffic
  load: {
    name: 'Load Test',
    description: 'Simulate normal production traffic',
    duration: '10m',
    vus: 100,
    iterations: 500,
  },

  // Stress test - above normal traffic
  stress: {
    name: 'Stress Test',
    description: 'Test system under heavy load to find breaking point',
    duration: '15m',
    vus: 200,
    iterations: 1000,
  },

  // Spike test - sudden traffic spike
  spike: {
    name: 'Spike Test',
    description: 'Simulate sudden traffic spike (e.g., viral event)',
    duration: '5m',
    vus: 500,
    iterations: 2000,
  },

  // Soak test - extended duration
  soak: {
    name: 'Soak Test',
    description: 'Extended test to find memory leaks and stability issues',
    duration: '1h',
    vus: 50,
    iterations: 1000,
  },

  // Bulk operations test
  bulk: {
    name: 'Bulk Operations Test',
    description: 'Test bulk invoice marketplace operations',
    duration: '20m',
    vus: 150,
    iterations: 1000,
  },
};

// Authentication configuration
export const auth = {
  // Number of test users to simulate
  farmers: 50,
  investors: 30,
  
  // Token refresh interval (in seconds)
  tokenRefreshInterval: 300,
  
  // Test user data template
  userTemplate: {
    farmer: {
      id: 'farmer-{index}',
      token: 'Bearer farmer-token-{index}',
      walletAddress: 'G{55-char-stellar-address}{index}',
    },
    investor: {
      id: 'investor-{index}',
      token: 'Bearer investor-token-{index}',
      walletAddress: 'G{55-char-stellar-address}{index}',
      balance: 100000,
    },
  },
};

// Invoice test data configuration
export const invoiceData = {
  // Amount range (in stroops or smallest currency unit)
  minAmount: 1000,
  maxAmount: 50000,
  
  // Supported currencies
  currencies: ['USDC', 'XLM', 'AQUA'],
  
  // Crop types for invoices
  crops: ['wheat', 'corn', 'soybeans', 'rice', 'cotton', 'coffee', 'cocoa'],
  
  // Due date range (days from now)
  minDueDays: 30,
  maxDueDays: 90,
  
  // Invoice statuses
  statuses: ['PENDING', 'FUNDED', 'SETTLED', 'EXPIRED'],
};

// Performance thresholds
export const thresholds = {
  // Response time thresholds (in milliseconds)
  responseTime: {
    p50: 200,
    p95: 800,
    p99: 1500,
    max: 5000,
  },
  
  // Error rate thresholds
  errorRate: {
    acceptable: 0.01, // 1%
    warning: 0.05, // 5%
    critical: 0.1, // 10%
  },
  
  // Throughput thresholds (requests per second)
  throughput: {
    min: 10,
    target: 100,
    max: 500,
  },
  
  // Custom operation thresholds
  operations: {
    invoiceCreation: {
      p95: 1000,
      p99: 2000,
    },
    invoiceFunding: {
      p95: 1200,
      p99: 2500,
    },
    invoiceSettlement: {
      p95: 1500,
      p99: 3000,
    },
  },
};

// Database test data limits
export const dataLimits = {
  // Maximum invoices to create in a single test
  maxInvoicesPerTest: 1000,
  
  // Maximum concurrent operations
  maxConcurrentOperations: 100,
  
  // Cleanup after test
  cleanupAfterTest: true,
  
  // Seed data before test
  seedData: {
    invoices: 100,
    farmers: 50,
    investors: 30,
  },
};

// Export configuration helper
export function getConfig(env = 'local', scenario = 'load') {
  const environment = environments[env] || environments.local;
  const scenarioConfig = scenarios[scenario] || scenarios.load;
  
  return {
    ...environment,
    ...scenarioConfig,
    auth,
    invoiceData,
    thresholds,
    dataLimits,
  };
}

// CLI argument parser
export function parseArgs() {
  const args = {};
  
  // Parse k6 environment variables
  if (__ENV.ENV) args.env = __ENV.ENV;
  if (__ENV.SCENARIO) args.scenario = __ENV.SCENARIO;
  if (__ENV.BASE_URL) args.baseUrl = __ENV.BASE_URL;
  if (__ENV.VUS) args.vus = parseInt(__ENV.VUS);
  if (__ENV.DURATION) args.duration = __ENV.DURATION;
  
  return args;
}