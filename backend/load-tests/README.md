# k6 Load and Stress Test Suite

Comprehensive load and stress testing suite for the InvoiceFi-Stellar invoice marketplace using k6.

## 📋 Table of Contents

- [Overview](#overview)
- [Test Suites](#test-suites)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running Tests](#running-tests)
- [Test Scenarios](#test-scenarios)
- [Interpreting Results](#interpreting-results)
- [CI/CD Integration](#cicd-integration)
- [Best Practices](#best-practices)

## 🎯 Overview

This test suite is designed to validate the performance, scalability, and stability of the InvoiceFi-Stellar invoice marketplace under various load conditions. It tests bulk operations including:

- **Invoice Creation** (Farmers minting invoices)
- **Invoice Browsing** (Investors browsing marketplace)
- **Invoice Funding** (Investors funding invoices from pool)
- **Invoice Settlement** (Farmers settling funded invoices)

## 📊 Test Suites

### 1. Rate Limiting Tests (`rate-limiting.k6.js`)
Tests the rate limiting functionality of the API:
- Per-IP rate limiting (unauthenticated endpoints)
- Per-user rate limiting (authenticated endpoints)
- Operation-level rate limiting (expensive operations)

**Use case:** Verify rate limiting is working correctly

### 2. Marketplace Bulk Operations (`marketplace-bulk-operations.k6.js`)
Comprehensive tests for bulk marketplace operations:
- Bulk invoice creation (50 VUs, 200 iterations)
- Bulk invoice browsing (100 VUs, 500 iterations)
- Bulk funding operations (30 VUs, 150 iterations)
- Bulk settlement (20 VUs, 100 iterations)
- Mixed realistic workload (ramping VUs)

**Use case:** Test normal and peak marketplace operations

### 3. Stress Test (`stress-test.k6.js`)
Finds the breaking point of the system:
- Gradual ramp-up from 10 to 500 VUs
- Spike test (sudden burst to 1000 VUs)
- Degradation detection and reporting

**Use case:** Identify system limits and breaking points

## 🔧 Prerequisites

### Install k6

**Windows (using Chocolatey):**
```bash
choco install k6
```

**macOS (using Homebrew):**
```bash
brew install k6
```

**Linux (using apt):**
```bash
sudo apt update
sudo apt install k6
```

**Docker:**
```bash
docker pull grafana/k6:latest
```

### Verify Installation
```bash
k6 version
```

## 📦 Installation

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install dependencies (if needed):
```bash
npm install
```

3. Ensure the backend server is running:
```bash
# Using Docker Compose
docker-compose up -d

# Or using npm
npm run start:dev
```

## ⚙️ Configuration

### Environment Variables

Set these environment variables before running tests:

```bash
# Base URL of the API
export BASE_URL=http://localhost:4000

# Test environment (local, staging, production, stress, soak)
export ENV=local

# Test scenario (smoke, load, stress, spike, soak, bulk)
export SCENARIO=load

# Number of virtual users (overrides config)
export VUS=50

# Test duration (overrides config)
export DURATION=5m
```

**Windows (PowerShell):**
```powershell
$env:BASE_URL="http://localhost:4000"
$env:ENV="local"
$env:SCENARIO="load"
```

**Windows (Command Prompt):**
```cmd
set BASE_URL=http://localhost:4000
set ENV=local
set SCENARIO=load
```

### Configuration File

Edit `k6-config.js` to customize:
- Test user counts (farmers, investors)
- Invoice data ranges
- Performance thresholds
- Database limits

## 🚀 Running Tests

### Quick Start

Run all tests in sequence:
```bash
cd backend/load-tests

# Run rate limiting tests
k6 run rate-limiting.k6.js

# Run marketplace bulk operations
k6 run marketplace-bulk-operations.k6.js

# Run stress test
k6 run stress-test.k6.js
```

### Using Docker

```bash
# Run with Docker
docker run -i grafana/k6:latest run - < rate-limiting.k6.js

# Or mount the test files
docker run -v $(pwd):/tests grafana/k6:latest run /tests/rate-limiting.k6.js
```

### Test Scenarios

#### 1. Smoke Test (Quick validation)
```bash
k6 run --vus 10 --duration 2m marketplace-bulk-operations.k6.js
```

#### 2. Load Test (Normal traffic)
```bash
k6 run --vus 100 --duration 10m marketplace-bulk-operations.k6.js
```

#### 3. Stress Test (Find breaking point)
```bash
k6 run stress-test.k6.js
```

#### 4. Spike Test (Sudden traffic burst)
```bash
k6 run --vus 500 --duration 5m marketplace-bulk-operations.k6.js
```

#### 5. Soak Test (Long-running stability)
```bash
k6 run --vus 50 --duration 1h marketplace-bulk-operations.k6.js
```

### Advanced Usage

#### Custom Scenarios
```bash
# Run specific scenario from config
k6 run -e ENV=staging -e SCENARIO=bulk marketplace-bulk-operations.k6.js

# Override VUs and duration
k6 run --vus 200 --duration 15m --threshold http_req_duration=p(95)<2000 stress-test.k6.js
```

#### Multiple Test Files
```bash
# Run all tests in sequence
for test in *.k6.js; do
  echo "Running $test..."
  k6 run "$test"
done
```

#### Parallel Execution
```bash
# Run tests in parallel (requires GNU Parallel or similar)
ls *.k6.js | parallel k6 run {}
```

## 📈 Test Scenarios

### Rate Limiting Test
- **Duration:** ~16 minutes
- **VUs:** 200 (peak)
- **Operations:** Health checks, invoice listing, invoice creation
- **Validates:** Rate limit headers, 429 responses, retry-after headers

### Marketplace Bulk Operations
- **Duration:** ~20 minutes
- **VUs:** 150 (peak in mixed workload)
- **Operations:** 
  - 200 invoice creations
  - 500 invoice browses
  - 150 funding operations
  - 100 settlement operations
- **Validates:** End-to-end marketplace workflow under load

### Stress Test
- **Duration:** ~17 minutes
- **VUs:** 0 → 500 → 0 (with spike to 1000)
- **Operations:** Mixed workload at increasing intensity
- **Validates:** System breaking point, degradation detection, recovery

## 📊 Interpreting Results

### Key Metrics

#### Response Time
- **p(95):** 95% of requests complete within this time
- **p(99):** 99% of requests complete within this time
- **avg:** Average response time

**Targets:**
- p(95) < 800ms (normal load)
- p(99) < 1500ms (normal load)
- p(95) < 5000ms (stress test)

#### Error Rate
- **rate:** Percentage of failed requests

**Targets:**
- < 1% (production)
- < 5% (staging)
- < 10% (stress test)

#### Custom Metrics
- **invoice_creation_duration:** Time to create invoices
- **invoice_funding_duration:** Time to fund invoices
- **invoice_settlement_duration:** Time to settle invoices
- **invoices_created/funded/settled:** Operation counters

### Pass/Fail Criteria

#### Rate Limiting Test
- ✅ All requests return 200 or 429
- ✅ Rate limit headers present
- ✅ Retry-after header on 429 responses

#### Marketplace Bulk Operations
- ✅ p(95) response time < 800ms
- ✅ Error rate < 5%
- ✅ All invoice operations complete successfully
- ✅ No data inconsistencies

#### Stress Test
- ✅ System handles 500 VUs without complete failure
- ✅ Error rate < 30% (relaxed for stress)
- ✅ p(95) < 5000ms
- ✅ Degradation point identified and logged

### Sample Output

```
✓ Invoice creation status is 201
✓ Invoice has id
✓ Invoice status is PENDING

http_req_duration..............: avg=245ms min=12ms med=189ms max=2.1s p(95)=567ms p(99)=1.2s
http_req_failed................: 2.34% ✓ 0.05
invoices_created...............: 200
invoices_funded................: 87
invoices_settled...............: 45

=== CUSTOM METRICS ===
{
  "invoices_created": 200,
  "invoices_funded": 87,
  "invoices_settled": 45,
  "avg_creation_time": 234.56,
  "avg_funding_time": 456.78,
  "avg_settlement_time": 567.89,
  "error_rate": 2.34
}
```

## 🔄 CI/CD Integration

### GitHub Actions

Create `.github/workflows/load-tests.yml`:

```yaml
name: Load Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM

jobs:
  load-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      
      redis:
        image: redis:7-alpine
        options: >-
          --health-cmd redis-cli ping
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3
      
      - name: Setup k6
        uses: grafana/setup-k6-action@v1
        
      - name: Start backend
        run: |
          cd backend
          npm install
          npm run start:dev &
          sleep 30  # Wait for server to start
          
      - name: Run rate limiting tests
        run: k6 run backend/load-tests/rate-limiting.k6.js
        
      - name: Run marketplace bulk operations
        run: k6 run backend/load-tests/marketplace-bulk-operations.k6.js
        
      - name: Upload results
        uses: actions/upload-artifact@v3
        with:
          name: k6-results
          path: |
            backend/load-tests/*.json
            backend/load-tests/*.log
```

### GitLab CI

Create `.gitlab-ci.yml`:

```yaml
load-tests:
  image: grafana/k6:latest
  services:
    - name: postgres:15
      alias: postgres
    - name: redis:7-alpine
      alias: redis
  script:
    - |
      cd backend
      npm install
      npm run start:dev &
      sleep 30
    - k6 run load-tests/rate-limiting.k6.js
    - k6 run load-tests/marketplace-bulk-operations.k6.js
  only:
    - merge_requests
    - main
```

## 📝 Best Practices

### 1. Test Environment
- ✅ Run tests against a dedicated test environment
- ✅ Use test data, not production data
- ✅ Isolate test environment from production
- ✅ Clean up test data after tests

### 2. Test Data
- ✅ Use SharedArray for test user data
- ✅ Generate realistic test data
- ✅ Avoid hardcoded values
- ✅ Clean up created resources

### 3. Thresholds
- ✅ Set realistic thresholds based on SLA
- ✅ Use different thresholds for different environments
- ✅ Relax thresholds for stress tests
- ✅ Monitor thresholds over time

### 4. Monitoring
- ✅ Monitor system metrics during tests (CPU, memory, database)
- ✅ Use k6 with Grafana/Prometheus for visualization
- ✅ Log degradation points in stress tests
- ✅ Capture detailed error information

### 5. Test Execution
- ✅ Run smoke tests before major tests
- ✅ Run tests during off-peak hours
- ✅ Gradually increase load (don't start with max VUs)
- ✅ Include ramp-up and ramp-down periods

### 6. Analysis
- ✅ Review results after each test run
- ✅ Track performance trends over time
- ✅ Investigate failures immediately
- ✅ Document breaking points and capacity limits

## 🐛 Troubleshooting

### Common Issues

#### 1. Connection Refused
```
Error: dial tcp [::1]:4000: connect: connection refused
```
**Solution:** Ensure backend server is running on the correct port

#### 2. Authentication Failures
```
status is 401
```
**Solution:** Verify test tokens are valid and not expired

#### 3. Rate Limited Immediately
```
status is 429
```
**Solution:** Reduce VUs or increase rate limits in test environment

#### 4. Timeouts
```
response time > 10s
```
**Solution:** Increase timeout values or optimize slow endpoints

#### 5. Memory Issues
```
FATAL: --vus exceeded maximum
```
**Solution:** Reduce VUs or increase system resources

## 📚 Additional Resources

- [k6 Documentation](https://k6.io/docs/)
- [k6 Examples](https://k6.io/docs/examples/)
- [k6 Cloud](https://k6.io/cloud/) - For distributed load testing
- [k6 Grafana Dashboard](https://grafana.com/grafana/dashboards/2587-k6-load-testing-results/)

## 🤝 Contributing

When adding new tests:
1. Follow the existing code structure
2. Add appropriate metrics and thresholds
3. Document the test purpose and usage
4. Update this README

## 📄 License

Part of the InvoiceFi-Stellar project.

---

**Last Updated:** 2026-01-26  
**Maintained by:** InvoiceFi-Stellar Team