# Contributing to InvoiceFi-Stellar

Thank you for helping build InvoiceFi-Stellar. This guide walks you through everything you need to get the full stack running locally and how to contribute code.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Clone and Install](#clone-and-install)
3. [Environment Variables](#environment-variables)
4. [Running the Full Stack](#running-the-full-stack)
5. [Running Services Individually (without Docker)](#running-services-individually-without-docker)
6. [Soroban Smart Contracts](#soroban-smart-contracts)
7. [Database Migrations](#database-migrations)
8. [Running Tests](#running-tests)
9. [CI Checks](#ci-checks)
10. [Pull Request Workflow](#pull-request-workflow)
11. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Install these tools before starting. The versions listed are the minimum tested.

| Tool | Version | Install |
|---|---|---|
| Node.js | 20 LTS | https://nodejs.org or `nvm install 20` |
| npm | 10+ (bundled with Node 20) | — |
| Rust (stable) | 1.78+ | https://rustup.rs |
| `wasm32-unknown-unknown` target | — | `rustup target add wasm32-unknown-unknown` |
| `rustfmt` + `clippy` | — | `rustup component add rustfmt clippy` |
| Stellar CLI | latest | https://developers.stellar.org/docs/tools/stellar-cli |
| Docker | 24+ | https://docs.docker.com/get-docker/ |
| Docker Compose | v2 (bundled with Docker Desktop) | — |
| Git | any recent | — |

> **Windows users:** run all commands in WSL 2 or Git Bash. PowerShell works for Docker commands but the Rust/Cargo toolchain is easier inside WSL.

### Verify your toolchain

```bash
node --version       # v20.x.x
npm --version        # 10.x.x
rustup show          # stable-... (default)
cargo --version      # cargo 1.78+
stellar --version    # stellar x.x.x
docker --version     # Docker version 24+
docker compose version  # Docker Compose version v2+
```

---

## Clone and Install

```bash
# 1. Clone the repo
git clone https://github.com/Christopherdominic/InvoiceFi-Stellar.git
cd InvoiceFi-Stellar

# 2. Install backend dependencies
cd backend && npm ci && cd ..

# 3. Install frontend dependencies
cd frontend && npm ci && cd ..
```

There is no monorepo root `package.json`, so you install each package separately.

---

## Environment Variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

Open `.env` and set at minimum:

| Variable | Required | Description |
|---|---|---|
| `POSTGRES_PASSWORD` | yes | Change from the default before any network-accessible deploy |
| `JWT_SECRET` | yes | At least 32 random characters — `openssl rand -hex 32` |
| `INVOICE_CONTRACT_ID` | yes (runtime) | Contract ID returned by `stellar contract deploy` (see below) |
| `SMTP_USER` / `SMTP_PASSWORD` | no | Only needed if you want invoice email reminders |

All other variables have working defaults for local development. See `.env.example` for the full reference with inline comments.

---

## Running the Full Stack

The easiest path uses Docker Compose, which starts PostgreSQL, Redis, a local Stellar node (standalone), the NestJS backend, and the Next.js frontend in one command.

```bash
# Copy and edit env first (see above)
cp .env.example .env

# Build images and start all services
docker compose up --build
```

Wait for the health checks to pass. You'll see log lines like:

```
invoicefi_backend   | Backend listening on port 4000
invoicefi_frontend  | ▲ Next.js 14.x.x
```

| Service | URL |
|---|---|
| Frontend (Next.js) | http://localhost:3000 |
| Backend API (NestJS) | http://localhost:4000 |
| Backend health check | http://localhost:4000/health |
| Horizon API | http://localhost:8000 |
| Soroban RPC | http://localhost:8001 |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

### Makefile shortcuts

```bash
make up       # docker compose up --build
make down     # docker compose down  (keeps volumes)
make clean    # docker compose down -v  (destroys volumes too)
make logs     # tail all service logs
make ps       # list running containers
make build    # rebuild images without starting
make staging  # start the testnet staging stack
```

---

## Running Services Individually (without Docker)

Use this when you want faster iteration on a single service without rebuilding images.

### 1. Start backing services

You still need PostgreSQL and Redis. The quickest way is to start only those containers:

```bash
docker compose up -d postgres redis stellar-standalone
```

### 2. Backend

```bash
cd backend

# Generate the Prisma client
npm run prisma:generate

# Apply migrations to the local DB
npx prisma migrate dev

# Start the NestJS dev server (ts-node, no build step)
npm run start:dev
```

The backend restarts automatically on file changes. It listens on `http://localhost:4000`.

### 3. Frontend

```bash
cd frontend

# Start Next.js dev server with hot reload
npm run dev
```

The frontend is available at `http://localhost:3000`.

---

## Soroban Smart Contracts

All contract work lives in the `contracts/` directory, which is a Cargo workspace containing two crates: `invoice` and `financing-pool`.

### Build the contracts

```bash
cd contracts

# Standard debug build
cargo build

# Production WASM build (optimised for deployment)
cargo build --release --target wasm32-unknown-unknown
```

Expected output (release build):

```
   Compiling invoice v0.1.0 (.../contracts/invoice)
   Compiling financing-pool v0.1.0 (.../contracts/financing-pool)
    Finished release [optimized] target(s) in Xs
```

WASM artefacts are written to `contracts/target/wasm32-unknown-unknown/release/`:

```
invoice.wasm
financing_pool.wasm
```

### Lint and format

```bash
# Check formatting (same check as CI)
cargo fmt --all -- --check

# Auto-fix formatting
cargo fmt --all

# Lint (warnings treated as errors, same as CI)
cargo clippy --all-targets --all-features
```

### Run contract unit tests

```bash
# Run all tests in the workspace
cargo test --all

# Run tests for a specific crate
cargo test -p invoice
cargo test -p financing-pool

# Show test output (useful for debugging)
cargo test --all -- --nocapture
```

### Deploy contracts to the local standalone network

Make sure `docker compose up -d stellar-standalone` is running first.

```bash
# Generate a deployer key pair and fund it from the standalone friendbot
stellar keys generate --global deployer --network standalone
stellar keys fund deployer --network standalone

# Deploy the invoice contract
stellar contract deploy \
  --wasm contracts/target/wasm32-unknown-unknown/release/invoice.wasm \
  --source deployer \
  --network standalone

# Deploy the financing-pool contract
stellar contract deploy \
  --wasm contracts/target/wasm32-unknown-unknown/release/financing_pool.wasm \
  --source deployer \
  --network standalone
```

Each `stellar contract deploy` command prints the deployed contract ID on success:

```
Contract deployed successfully with ID: CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Copy that ID into your `.env` file:

```env
INVOICE_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXX...
```

### Initialize the deployed contracts

After deployment, call `initialize` on each contract. Replace `<ADMIN_ADDRESS>` with your deployer's public key (`stellar keys address deployer`):

```bash
# Initialize the invoice contract
stellar contract invoke \
  --id <INVOICE_CONTRACT_ID> \
  --source deployer \
  --network standalone \
  -- initialize \
  --admin <ADMIN_ADDRESS>

# Initialize the financing-pool contract (discount_bps = 500 = 5%)
stellar contract invoke \
  --id <FINANCING_POOL_CONTRACT_ID> \
  --source deployer \
  --network standalone \
  -- initialize \
  --admin <ADMIN_ADDRESS> \
  --discount_bps 500
```

### Deploy to testnet

Use the staging stack which connects to Stellar testnet:

```bash
make staging
```

Then run the same `stellar contract deploy` commands above but add `--network testnet` instead of `--network standalone`. The Stellar testnet friendbot is available at `https://friendbot.stellar.org?addr=<PUBLIC_KEY>`.

---

## Database Migrations

Migrations are handled by Prisma and run automatically when the backend Docker container starts (`prisma migrate deploy`). For local non-Docker development:

```bash
cd backend

# Apply all pending migrations
npx prisma migrate dev

# Create a new migration after editing prisma/schema.prisma
npx prisma migrate dev --name describe_your_change

# Reset the DB and re-apply all migrations (destructive!)
npx prisma migrate reset

# Open Prisma Studio to browse data
npx prisma studio
```

---

## Running Tests

### Backend

```bash
cd backend
npm test               # run all *.spec.ts files once
npm run test:watch     # watch mode
```

### Frontend

```bash
cd frontend
npm run lint           # ESLint (same check as CI)
```

### Contracts

```bash
cd contracts
cargo test --all
```

---

## CI Checks

Three required checks must pass on every PR before merge:

| Check | What it runs |
|---|---|
| `contract-build-test` | `cargo fmt --check`, `cargo clippy`, `cargo test --all` |
| `backend-test` | `npm ci` + `npm test -- --runInBand` |
| `frontend-lint` | `npm ci` + `npm run lint` |

Run these locally before opening a PR to catch issues early:

```bash
# Contracts
cd contracts && cargo fmt --all -- --check && cargo clippy --all-targets --all-features && cargo test --all

# Backend
cd backend && npm test -- --runInBand

# Frontend
cd frontend && npm run lint
```

---

## Pull Request Workflow

1. Fork the repository and create a branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```

2. Make your changes and write tests for new behaviour.

3. Ensure all three CI checks pass locally (see above).

4. Push your branch and open a pull request targeting `main` or `develop`.

5. Fill in the PR description: what changed, how you tested it, and any known gaps.

PRs that break existing tests or skip CI will not be merged.

---

## Troubleshooting

### Freighter wallet not detected

**Symptom:** The frontend shows "Freighter not detected" or wallet connection fails silently.

**Causes and fixes:**

- **Extension not installed.** Install [Freighter](https://www.freighter.app/) from the Chrome or Firefox extension store.
- **Extension installed but not enabled on localhost.** Open the Freighter extension, go to Settings → Experimental Features, and make sure "Allow connection to localhost" is enabled.
- **Wrong network selected.** Freighter must be set to the same network as the running backend. For local development that is the **Standalone** network (passphrase: `Standalone Network ; February 2017`). For staging, use **Testnet**.
  - Open Freighter → Network → Add Custom Network with RPC URL `http://localhost:8001` and the standalone passphrase.
- **Page loaded before extension injected.** Freighter injects `window.freighter` asynchronously. If the page loads faster than the extension, refresh once after the extension icon appears in the toolbar.

---

### Contract deploy failures

**Symptom:** `stellar contract deploy` exits with an error.

| Error | Likely cause | Fix |
|---|---|---|
| `connection refused` on port 8001 | Stellar standalone container not running | `docker compose up -d stellar-standalone` and wait ~10 s for it to be healthy |
| `account not found` or `insufficient balance` | Deployer key not funded | `stellar keys fund deployer --network standalone` |
| `no such file or directory: invoice.wasm` | WASM not built yet | `cd contracts && cargo build --release --target wasm32-unknown-unknown` |
| `Error: invalid contract` | WASM built in debug mode | Always use `--release` flag; debug WASM is not accepted by Soroban |
| `wasm32 target not installed` | Missing Rust target | `rustup target add wasm32-unknown-unknown` |
| `contract already initialized` | `initialize` called twice | This is safe to ignore; the contract state is unchanged |

---

### DB migration errors

**Symptom:** Backend fails to start with Prisma errors, or `npx prisma migrate dev` exits with an error.

| Error | Likely cause | Fix |
|---|---|---|
| `Can't reach database server at localhost:5432` | PostgreSQL not running | `docker compose up -d postgres` |
| `password authentication failed` | `DATABASE_URL` creds don't match `POSTGRES_USER`/`POSTGRES_PASSWORD` | Ensure both are consistent in `.env` |
| `migration drift detected` | Local schema diverged from migration history | `npx prisma migrate reset` (drops and re-creates the DB) |
| `P3005: database schema is not empty` | Existing DB has tables not in migration history | Run `npx prisma migrate resolve --applied 00000000000000_init` then `npx prisma migrate deploy` |
| `Environment variable not found: DATABASE_URL` | `.env` not created or not in the `backend/` working directory | `cp .env.example .env` from the repo root, then ensure you run prisma commands from `backend/` |

For a clean-slate reset during development:

```bash
# Stop and destroy all data volumes
docker compose down -v

# Restart — migrations run automatically on container start
docker compose up --build
```

---

*Still stuck? Open an issue or start a discussion on GitHub.*
