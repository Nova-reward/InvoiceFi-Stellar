# InvoiceF-Stellar

A decentralized harvest invoice financing protocol built on Stellar. InvoiceFi Stellar enables smallholder farmers to tokenize future crop yields as on-chain invoices and access instant working capital from DeFi liquidity providers via Soroban smart contracts.

The protocol transforms agricultural future yields into tradable financial assets, improving liquidity access for farmers while providing transparent yield-backed opportunities for investors.

---
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

### Clone Repository

```bash
git clone https://github.com/dev-fatima-24/AgroLedger.git
cd AgroLedger
```

### Install Dependencies

```bash
npm install
```

### Run Development Server

```bash
npm run dev
```

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

1. Fork the repository  
2. Create a feature branch  
3. Commit your changes  
4. Push and open a Pull Request  

---

## License

MIT License

---

## Vision

InvoiceFi Stellar aims to unlock agricultural liquidity by transforming future harvests into verifiable on-chain financial instruments, connecting farmers to global decentralized capital markets.
```
