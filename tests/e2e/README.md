# InvoiceFi-Stellar E2E Test Suite

Comprehensive Playwright E2E tests covering the full invoice credit lifecycle
against a real local Soroban stack (Docker Compose).

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Docker + Docker Compose v2 | ≥ 24.0 | Local stack orchestration |
| Node.js | ≥ 20 | Playwright runner + setup scripts |
| npm | ≥ 10 | Dependency management |
| Stellar CLI | ≥ 21 | Contract deployment (optional for CI) |

## Quick Start

```bash
# 1. From the repo root, copy env and start the stack
cp .env.example .env
docker compose up -d --build

# 2. Wait for services, then provision accounts
cd tests/e2e
npm ci
npx playwright install chromium --with-deps
node scripts/provision-accounts.mjs

# 3. (Optional) Deploy contracts to local Soroban
node scripts/deploy-contracts.mjs

# 4. Run the tests
npm test
```

Or use the one-shot setup script:

```bash
cd tests/e2e
chmod +x scripts/setup-test-env.sh
./scripts/setup-test-env.sh --run-tests
```

## Running with Docker Compose Test Profile

The `docker-compose.yml` includes a `test` profile that runs the full E2E
suite inside a container:

```bash
docker compose --profile test up --build
docker compose --profile test down -v
```

## Test Scenarios

| # | File | Scenario |
|---|------|----------|
| 1–5 | `01-happy-path.spec.ts` | Full lifecycle: connect wallet → create invoice → fund → settle → pool stats |
| 6–10 | `02-wallet-connection.spec.ts` | Wallet connect, Freighter detection, disconnect redirect, role-based access |
| 11–15 | `03-invoice-creation.spec.ts` | Wizard validation, email validation, step navigation, API auth, dashboard |
| 16–20 | `04-investor-funding.spec.ts` | Fund invoice, duplicate funding rejection, amount exceeded, 404, portfolio |
| 21–25 | `05-repayment-settlement.spec.ts` | Full repayment, partial repayment, idempotent settle, non-funded settle |
| 26–28 | `06-default-timeout.spec.ts` | Default status, expired invoice, investor dashboard |
| 29–32 | `07-dispute-conflict.spec.ts` | Dispute flow, wrong-party settle, dashboard data, investor portfolio |
| 33–36 | `08-multi-investor.spec.ts` | Multiple invoices, competing funding, isolated portfolios, self-funding |
| 37–40 | `09-wallet-disconnect.spec.ts` | Mid-flow disconnect, session clearing, Freighter unavailable |
| 41–48 | `10-pool-financial.spec.ts` | Pool stats, invoice listing, health check, auth idempotency, full UI flow |

**Total: 48 tests across 10 spec files**

## Debugging

```bash
# Run with browser visible
npm run test:headed

# Interactive debugging with Playwright Inspector
npm run test:debug

# Run with Playwright UI mode
npm run test:ui

# View HTML report after test run
npm run test:report
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:3000` | Frontend URL |
| `API_URL` | `http://localhost:4000` | Backend API URL |
| `HORIZON_URL` | `http://localhost:8000` | Horizon API |
| `SOROBAN_RPC_URL` | `http://localhost:8001` | Soroban RPC |
| `NETWORK_PASSPHRASE` | `Standalone Network ; February 2017` | Stellar network |
| `FARMER_WALLET_ADDRESS` | _(auto-provisioned)_ | Farmer test account |
| `INVESTOR_WALLET_ADDRESS` | _(auto-provisioned)_ | Investor test account |
| `CI` | `false` | Enables CI-specific reporter + retry |

## Architecture

```
tests/e2e/
├── playwright.config.ts       # Playwright configuration
├── package.json               # Dependencies
├── Dockerfile                 # E2E runner container
├── fixtures/
│   ├── test-fixtures.ts       # Playwright test fixtures + Freighter mock
│   └── helpers.ts             # WalletHelper + APIHelper classes
├── scripts/
│   ├── provision-accounts.mjs # Stellar account provisioning
│   ├── deploy-contracts.mjs   # Soroban contract deployment
│   └── setup-test-env.sh      # One-shot setup script
└── tests/
    ├── 01-happy-path.spec.ts
    ├── 02-wallet-connection.spec.ts
    ├── 03-invoice-creation.spec.ts
    ├── 04-investor-funding.spec.ts
    ├── 05-repayment-settlement.spec.ts
    ├── 06-default-timeout.spec.ts
    ├── 07-dispute-conflict.spec.ts
    ├── 08-multi-investor.spec.ts
    ├── 09-wallet-disconnect.spec.ts
    └── 10-pool-financial.spec.ts
```

## CI Integration

The E2E suite runs in GitHub Actions via `.github/workflows/e2e-ci.yml`:
- Triggers on pushes/PRs affecting `backend/`, `frontend/`, `contracts/`, `tests/e2e/`
- Starts the full Docker Compose stack
- Provisions Stellar accounts and deploys contracts
- Runs Playwright with `--reporter=github,html`
- Uploads test reports and results as artifacts
- Full suite completes in under 15 minutes

## Troubleshooting

**Port conflicts:** Ensure ports 3000, 4000, 5432, 6379, 8000, 8001 are free.

**Stellar node slow to start:** The standalone node can take 30–60s to become
fully operational. The setup script retries automatically.

**Flaky tests:** Tests that depend on on-chain state may occasionally be slow.
The CI configuration retries failed tests up to 2 times. If a specific test
is consistently flaky, check that the Stellar node is fully synced.

**Debug mode:** Run `npm run test:debug` to step through tests interactively
with the Playwright Inspector.

**Contract deployment fails:** Ensure the Rust toolchain and `stellar` CLI are
installed. The contracts need to be built first (`cargo build --release` in
`contracts/`).
