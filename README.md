# InvoiceF-Stellar

A decentralized harvest invoice financing protocol built on Stellar. InvoiceFi Stellar enables smallholder farmers to tokenize future crop yields as on-chain invoices and access instant working capital from DeFi liquidity providers via Soroban smart contracts.

The protocol transforms agricultural future yields into tradable financial assets, improving liquidity access for farmers while providing transparent yield-backed opportunities for investors.

---
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/0c648ce3-bf48-4b48-a7a7-c1b409caa419" />

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/7ec65e4a-4014-404f-a61b-012cb939ce31" />
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/7195222a-ae89-4aff-bc57-786a3bdc9f1a" />
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/fe9eb7ce-7fc5-4bea-91dc-431f1061915b" />
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/f7e80d99-9d59-4f05-8b68-0517c0c30f68" />
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/91b57e42-8af0-4868-9a23-9b3c39fa0fef" />

website rediflow-stellar-capital.lovable.app


## Features

### Harvest Invoice Tokenization
- Mint crop yield invoices as NFTs
- Represent future harvests as on-chain assets
- Store invoice metadata and valuation data

### Invoice Financing
- Discounted invoice financing mechanism
- Liquidity pool funding for invoices
- Instant working capital for farmers
- Risk-adjusted financing rates

### Repayment & Settlement
- Yield-based repayment verification
- Automated smart contract settlement
- Transparent repayment tracking
- On-chain fund distribution

### Multi-Token Support
- XLM
- USDC
- AQUA

### Dashboards
- Farmer dashboard for invoice creation and tracking
- Investor dashboard for financing and portfolio management
- Real-time funding analytics

---

## Stack

- Soroban (Rust smart contracts)
- Stellar Blockchain
- Next.js 14 (Frontend)
- NestJS (Backend API)
- PostgreSQL (Database)
- Prisma ORM

---

## Architecture

```text
Frontend (Next.js)
        |
        v
Backend API (NestJS)
        |
        v
PostgreSQL Database
        |
        v
Soroban Smart Contracts
        |
        v
Stellar Blockchain
```

---

## Getting Started

For a complete step-by-step guide — including prerequisites, environment setup, Soroban contract deployment, and troubleshooting — see **[CONTRIBUTING.md](./CONTRIBUTING.md)**.

Quick start with Docker:

```bash
git clone https://github.com/Christopherdominic/InvoiceFi-Stellar.git
cd InvoiceFi-Stellar

# Copy and configure environment variables
cp .env.example .env
# Edit .env — set JWT_SECRET and POSTGRES_PASSWORD at minimum

# Start the full stack (PostgreSQL, Redis, Stellar node, backend, frontend)
docker compose up --build
```

| Service | URL |
| --- | --- |
| Frontend (Next.js) | http://localhost:3000 |
| Backend API (NestJS) | http://localhost:4000 |
| Horizon API | http://localhost:8000 |
| Soroban RPC | http://localhost:8001 |
| PostgreSQL | localhost:5432 |

---

## Docker – Local Development

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) ≥ 24
- [Docker Compose](https://docs.docker.com/compose/) v2 (bundled with Docker Desktop)

### Setup

```bash
# 1. Copy environment template
cp .env.example .env
# Edit .env with your secrets before proceeding

# 2. Start the full stack
docker compose up --build
```

| Service            | URL                           |
| ------------------ | ----------------------------- |
| Frontend (Next.js) | http://localhost:3000         |
| Backend (NestJS)   | http://localhost:4000         |
| Horizon API        | http://localhost:8000         |
| Soroban RPC        | http://localhost:8001         |
| PostgreSQL         | localhost:5432                |

```bash
# Stop containers (keep data volumes)
docker compose down

# Full teardown – removes containers AND volumes
docker compose down -v
```

### Makefile shortcuts

```bash
make up       # docker compose up --build
make down     # docker compose down
make clean    # docker compose down -v
make logs     # tail all service logs
make ps       # show running containers
make staging  # start staging stack
```

### Staging

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml up --build
```

The staging override switches the Stellar node to **testnet**, sets `NODE_ENV=staging`, and removes host-port exposure for the database and Stellar services.

---

## Smart Contract Modules

### Invoice Contract
Handles:
- Invoice minting
- Metadata storage
- Ownership tracking

### Financing Pool Contract
Handles:
- Liquidity provision
- Invoice funding
- Discount logic

### Settlement Contract
Handles:
- Repayment processing
- Yield verification
- Fund distribution

---

## Project Structure

```text
AgroLedger/
├── contracts/
│   ├── invoice/
│   ├── financing-pool/
│   └── settlement/
│
├── frontend/
│   ├── app/
│   ├── components/
│   ├── hooks/
│   └── lib/
│
├── backend/
│   ├── src/
│   ├── modules/
│   ├── prisma/
│   └── queues/
│
└── README.md
```

---

## Future Roadmap

- Oracle-based crop yield verification
- Insurance layer for harvest risk
- DAO governance for liquidity pools
- Cross-chain invoice financing
- AI-based credit risk scoring
- Mobile farmer onboarding application

---

## Contributing

Read **[CONTRIBUTING.md](./CONTRIBUTING.md)** for the full contributor guide, including:

- Prerequisites (Node.js 20, Rust stable, Stellar CLI, Docker)
- Step-by-step local setup from clone to `npm run dev`
- Soroban contract build, deploy, and initialize commands
- Database migration workflow
- How to run the test suite and pass CI checks
- Troubleshooting: Freighter not detected, contract deploy failures, DB migration errors

## CI / Branch Protection

GitHub Actions runs on pull requests targeting `main` and `develop` and must pass these required checks before merge:

| Check | What it validates |
| --- | --- |
| `contract-build-test` | Rust fmt, Clippy, and `cargo test --all` |
| `backend-test` | NestJS unit tests via Jest |
| `frontend-lint` | Next.js ESLint |

Configure branch protection for `main` and `develop` to require all three checks and to block merges until they succeed.

---

## License

MIT License

---

## Vision

InvoiceFi Stellar aims to unlock agricultural liquidity by transforming future harvests into verifiable on-chain financial instruments, connecting farmers to global decentralized capital markets.
