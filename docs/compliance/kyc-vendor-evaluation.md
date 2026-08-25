# KYC/AML Vendor Evaluation — InvoiceFi

**Status:** Draft  
**Author:** AI-assisted research  
**Date:** 2026-07-20  
**Branch:** `feature/kyc-aml-integration-design`

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Regulatory Context](#regulatory-context)
3. [Vendor Shortlist & Profiles](#vendor-shortlist--profiles)
4. [Evaluation Matrix](#evaluation-matrix)
5. [Recommended Vendor: Sumsub](#recommended-vendor-sumsub)
6. [Technical Integration Design](#technical-integration-design)
7. [Data Model Additions (Prisma Schema)](#data-model-additions-prisma-schema)
8. [API Flow: Onboarding & Verification](#api-flow-onboarding--verification)
9. [Webhook Event Handling](#webhook-event-handling)
10. [Re-KYC Trigger Logic](#re-kyc-trigger-logic)
11. [Graceful Degradation](#graceful-degradation)
12. [Privacy Considerations & PII Handling](#privacy-considerations--pii-handling)
13. [Implementation Roadmap](#implementation-roadmap)

---

## Executive Summary

InvoiceFi is a Stellar-based DeFi protocol for invoice financing. As the protocol scales across jurisdictions, KYC/AML verification becomes mandatory above regulatory thresholds (e.g., occasional transaction limits under FATF guidance, AMLD6 in the EU, and FinCEN rules in the US). This document evaluates four leading KYC/AML vendors, recommends **Sumsub** as the primary provider, and delivers a complete technical integration design.

**Key Recommendation:** Sumsub is the recommended vendor due to its *native crypto/blockchain specialization* (Chainalysis integration, Travel Rule compliance, wallet address verification), all-in-one platform (KYC + KYB + AML + Transaction Monitoring), mature REST API with webhooks, and proven track record with 4,000+ clients including crypto exchanges.

---

## Regulatory Context

InvoiceFi participants (farmers seeking invoice financing and investors providing liquidity) may trigger KYC/AML obligations under:

| Regulation | Jurisdiction | Threshold / Trigger |
|---|---|---|
| AMLD6 / AMLR | EU | All crypto-asset service providers (CASPs) |
| FinCEN (BSA) | US | MSB registration if operating as money transmitter |
| FATF Recommendation 15 | Global | Virtual Asset Service Providers (VASPs) must KYC |
| MiCA | EU | CASP authorization for ≥ €1M daily volume |
| Travel Rule (FATF R.16) | Global | Transactions ≥ $1,000 USD/EUR |

> **Note:** Actual regulatory thresholds depend on InvoiceFi's legal structure and jurisdictions of operation. This document does not constitute legal advice. Consult qualified counsel before determining your specific obligations.

---

## Vendor Shortlist & Profiles

### 1. Sumsub

| Dimension | Details |
|---|---|
| **Headquarters** | London, UK (global offices) |
| **Founded** | 2015 |
| **Clients** | 4,000+ (Binance, Bybit, Wirex, Exness) |
| **Crypto Specialization** | Chainalysis-integrated transaction monitoring, Travel Rule, wallet address verification & attribution, crypto asset screening |
| **Core Products** | User Verification, Business Verification (KYB), Transaction Monitoring, Fraud Prevention, Travel Rule Compliance |
| **API Style** | RESTful, WebSDK, Mobile SDKs (iOS/Android), Postman collections |
| **Webhooks** | Yes — `applicantReviewed`, `applicantPending`, `applicantCreated`, plus custom events |
| **Document Types** | 14,000+ document types across 220+ countries |
| **Biometrics** | Face matching, liveness detection (iBeta Level 1 & 2) |
| **AML Screening** | PEPs, sanctions, adverse media, watchlists |
| **Data Residency** | EU (Frankfurt), US, UK, UAE, Singapore, Brazil, India, Indonesia |
| **Certifications** | ISO 27001, SOC 2 Type II, GDPR, PCI DSS Level 1, iBeta Level 1 & 2, FIDO Alliance |
| **Pricing Model** | Per-applicant verifications + transaction monitoring volume; volume discounts available; custom enterprise pricing |
| **Sandbox** | Full sandbox with simulated review responses; free for testing |

### 2. Persona

| Dimension | Details |
|---|---|
| **Headquarters** | San Francisco, CA, USA |
| **Founded** | 2018 |
| **Clients** | Coursera, Reddit, Udemy, Square, Brex |
| **Crypto Specialization** | Listed as industry vertical; not as deep as Sumsub (no native Chainalysis/Travel Rule) |
| **Core Products** | Verifications (Government ID, Selfie, Database), Dynamic Flow, Workflows, Graph (fraud detection), Cases, KYB |
| **API Style** | RESTful, Mobile SDKs (iOS/Android), Embedded/Hosted flows |
| **Webhooks** | Yes — comprehensive event system via webhooks |
| **Document Types** | 200+ countries and territories |
| **Biometrics** | Selfie verification, liveness detection (iBeta certified) |
| **AML Screening** | Watchlists, adverse media, PEPs |
| **Data Residency** | US (primary), with EU data processing capabilities |
| **Certifications** | SOC 2 Type II, ISO 27001, GDPR, CCPA, HIPAA, PCI, FERPA, iBeta |
| **Pricing Model** | Per-verification pricing; tiered plans with platform fee; custom enterprise |
| **Sandbox** | Full sandbox environment available |

### 3. Jumio

| Dimension | Details |
|---|---|
| **Headquarters** | Palo Alto, CA, USA |
| **Founded** | 2010 |
| **Clients** | Alaska Airlines, Stanleybet, Personal Pay; crypto exchanges |
| **Crypto Specialization** | Dedicated crypto vertical page; account opening/trading/withdrawal flows for exchanges |
| **Core Products** | ID Verification, Selfie Verification, Liveness Detection, Document Verification, AML Screening, Risk Signals, Jumio Watch |
| **API Style** | RESTful, Mobile SDKs, Web SDK |
| **Webhooks** | Yes |
| **Document Types** | 5,000+ ID types across 200+ countries |
| **Biometrics** | Face matching, premium liveness detection, deepfake detection |
| **AML Screening** | PEPs, sanctions, watchlists, government database checks |
| **Data Residency** | US, EU |
| **Certifications** | SOC 2, ISO 27001, GDPR, PCI DSS, iBeta, FIDO |
| **Pricing Model** | Per-transaction; volume tiers; enterprise plans |
| **Sandbox** | Yes |

### 4. Veriff

| Dimension | Details |
|---|---|
| **Headquarters** | Tallinn, Estonia |
| **Founded** | 2015 |
| **Clients** | 3,000+ (Stake, Bolt, Juancho Te Presta, Bancoli) |
| **Crypto Specialization** | General fintech focus; no dedicated crypto/blockchain features |
| **Core Products** | Identity & Document Verification, Biometric Authentication, Fraud Protect, KYB, AML Screening, Proof of Address |
| **API Style** | RESTful, Mobile SDKs, Web SDK |
| **Webhooks** | Yes |
| **Document Types** | 12,500+ documents across 230+ countries |
| **Biometrics** | 1,000+ signals per session, 99.6% accuracy, 6s decision time |
| **AML Screening** | AML Screening included |
| **Data Residency** | EU (primary), US |
| **Certifications** | SOC 2 Type II, ISO 27001:2022, GDPR, CCPA, iBeta Level 1 & 2, FIDO |
| **Pricing Model** | Self-serve plans + enterprise; per-verification |
| **Sandbox** | Yes |

---

## Evaluation Matrix

Each vendor scored on a 1–5 scale (5 = best) across dimensions weighted by relevance to InvoiceFi's needs as a Stellar-based DeFi protocol.

| Criterion | Weight | Sumsub | Persona | Jumio | Veriff |
|---|---|---|---|---|---|
| **Crypto/Blockchain Specialization** | 25% | 5 | 3 | 4 | 2 |
| **API Quality & Developer Experience** | 20% | 5 | 5 | 4 | 4 |
| **Transaction Monitoring (Crypto)** | 15% | 5 | 2 | 3 | 2 |
| **Travel Rule Compliance** | 10% | 5 | 1 | 2 | 1 |
| **Jurisdiction Coverage** | 10% | 4 | 4 | 4 | 5 |
| **Document Type Coverage** | 5% | 5 | 4 | 4 | 5 |
| **Data Residency Options** | 5% | 5 | 3 | 3 | 4 |
| **AML/Watchlist Screening** | 5% | 5 | 4 | 4 | 4 |
| **Pricing Transparency** | 3% | 3 | 3 | 3 | 4 |
| **Stellar Ecosystem Precedent** | 2% | 3 | 2 | 2 | 1 |
| **Weighted Total** | **100%** | **4.80** | **3.35** | **3.45** | **2.85** |

### Scoring Notes

- **Sumsub's crypto specialization is unmatched:** Chainalysis-integrated transaction monitoring, Travel Rule compliance, wallet attribution, and crypto asset screening are built into the platform — not add-ons. Their client list (Binance, Bybit, Wirex) demonstrates battle-tested crypto KYC at scale.

- **Persona excels at developer experience and modularity:** Dynamic Flow builder and Graph-based fraud detection are excellent, but the lack of native crypto transaction monitoring and Travel Rule support are significant gaps for a DeFi protocol.

- **Jumio has strong identity verification** but lacks the integrated crypto transaction monitoring that Sumsub offers. Their crypto vertical is focused on exchange account opening rather than ongoing DeFi transaction monitoring.

- **Veriff has the best jurisdiction coverage** (230+ countries) and strong biometrics, but no crypto/blockchain-specific features. For a non-crypto fintech, Veriff would rank much higher.

---

## Recommended Vendor: Sumsub

### Justification

Sumsub is the recommended KYC/AML vendor for InvoiceFi for the following reasons:

1.  **Native Blockchain & Crypto Support.** Sumsub is the only evaluated vendor with native Chainalysis integration for crypto transaction monitoring, wallet address verification/attribution, and Travel Rule compliance. For a Stellar-based DeFi protocol, the ability to screen Stellar wallet addresses, monitor on-chain transaction patterns, and comply with the FATF Travel Rule is critical.

2.  **All-in-One Platform.** Sumsub covers the full compliance lifecycle — onboarding KYC, ongoing AML screening, crypto transaction monitoring, and Travel Rule — in a single platform. This eliminates the need to integrate multiple vendors (e.g., one for KYC + another for blockchain analytics).

3.  **Production-Proven at Scale.** With 4,000+ clients including major crypto exchanges (Binance, Bybit) and a reported 240% ROI per Forrester Consulting, Sumsub has demonstrated reliability in high-volume production environments.

4.  **Developer-First API.** Comprehensive REST API with Postman collections, WebSDK (embeddable iframe/web component), and native mobile SDKs. Webhooks for real-time event streaming. Full sandbox environment with simulated review responses.

5.  **Flexible Verification Levels.** Sumsub supports tiered verification levels — allowing InvoiceFi to implement risk-based KYC: light verification for low-value participants, full KYC for those above thresholds.

6.  **Data Residency.** Multiple data processing regions (EU, US, UK, UAE, Singapore, Brazil, India, Indonesia) allow InvoiceFi to meet jurisdiction-specific data residency requirements.

7.  **Reusable KYC.** Sumsub ID Connect allows verified users to reuse their KYC across platforms, reducing friction for InvoiceFi users who are already verified elsewhere in the Sumsub ecosystem.

### Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Pricing at scale (per-applicant costs) | Negotiate volume-based enterprise pricing; implement risk-tiered verification (light KYC for low-value, full KYC for high-value) |
| Vendor lock-in | Abstract KYC behind a service interface; store verification status/references locally to enable migration |
| Sumsub may process PII outside preferred region | Specify data residency in contract; use Frankfurt data center for EU users |
| Single point of failure if Sumsub is down | Implement graceful degradation (see [Graceful Degradation](#graceful-degradation)) |

---

## Technical Integration Design

### Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                    InvoiceFi Frontend                 │
│  ┌─────────────┐  ┌──────────────────────────────┐   │
│  │ Wallet Auth  │  │  KYC Onboarding Component    │   │
│  │ (Freighter)  │  │  <SumsubWebSDK />            │   │
│  └─────────────┘  └──────────────────────────────┘   │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│                 InvoiceFi Backend (NestJS)            │
│  ┌──────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │ KYC      │  │ KYC        │  │ KYC              │  │
│  │ Controller│  │ Service    │  │ Webhook Handler  │  │
│  └──────────┘  └────────────┘  └──────────────────┘  │
│                       │                  ▲            │
│                       ▼                  │            │
│              ┌────────────────┐          │            │
│              │  Prisma / DB   │──────────┘            │
│              └────────────────┘                       │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│                   Sumsub Platform                      │
│  ┌──────────┐  ┌───────────┐  ┌───────────────────┐  │
│  │ KYC/IDV  │  │ AML       │  │ Transaction       │  │
│  │ Engine   │  │ Screening │  │ Monitoring (Crypto)│  │
│  └──────────┘  └───────────┘  └───────────────────┘  │
│  ┌──────────────┐  ┌─────────────────────────────┐   │
│  │ Travel Rule  │  │ Webhooks → InvoiceFi Backend │   │
│  └──────────────┘  └─────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

### Module Structure

New NestJS module: `backend/src/kyc/`

```
backend/src/kyc/
├── kyc.module.ts          # NestJS module definition
├── kyc.controller.ts      # REST endpoints for KYC actions
├── kyc.service.ts         # Core business logic & Sumsub API calls
├── kyc.webhook.controller.ts  # Webhook receiver (unauthenticated endpoint)
├── sumsub/
│   ├── sumsub.client.ts   # HTTP client for Sumsub REST API
│   ├── sumsub.types.ts    # TypeScript types for Sumsub API contracts
│   └── sumsub.signature.ts # Request signing per Sumsub auth spec
├── dto/
│   ├── create-applicant.dto.ts
│   ├── generate-token.dto.ts
│   └── webhook-payload.dto.ts
└── strategies/
    └── kyc-level.strategy.ts  # Risk-based verification level logic
```

---

## Data Model Additions (Prisma Schema)

The following models should be added to `backend/prisma/schema.prisma`:

```prisma
// =============================================================================
// KYC/AML Models — Sumsub Integration
// =============================================================================

enum KycStatus {
  NOT_STARTED
  PENDING
  VERIFIED
  REJECTED
  EXPIRED
  RESET
}

enum KycLevel {
  LIGHT      // Basic: name + email + wallet ownership proof
  STANDARD   // Standard: government ID + selfie + AML screen
  ENHANCED   // Enhanced: STANDARD + proof of address + source of funds
}

model KycApplicant {
  id              Int         @id @default(autoincrement())
  userId          String      @unique  // FK to User (wallet public key for InvoiceFi)
  sumsubApplicantId String    @unique  // Sumsub external applicant ID
  externalUserId  String      @unique  // Sumsub externalUserId (our internal ref)
  inspectionId    String?              // Latest Sumsub inspection/check ID
  level           KycLevel    @default(LIGHT)
  status          KycStatus   @default(NOT_STARTED)
  reviewResult    Json?                // Cached review result from Sumsub
  riskScore       Float?               // Cached risk score (0-100)
  verifiedAt      DateTime?
  expiresAt       DateTime?            // When KYC verification expires
  lastReviewedAt  DateTime?
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  @@index([userId])
  @@index([status])
  @@index([level])
  @@index([expiresAt])
}

model KycEvent {
  id              Int         @id @default(autoincrement())
  applicantId     Int                      // FK to KycApplicant.id
  sumsubApplicantId String                 // Denormalized for fast lookup
  eventType       String                   // e.g., applicantReviewed, applicantPending
  eventPayload    Json                     // Full webhook payload
  processedAt     DateTime    @default(now())
  createdAt       DateTime    @default(now())

  @@index([sumsubApplicantId])
  @@index([eventType])
  @@index([createdAt])
}

model KycDocument {
  id              Int         @id @default(autoincrement())
  applicantId     Int                      // FK to KycApplicant.id
  sumsubImageId   String      @unique     // Sumsub image/document ID
  docType         String                   // e.g., ID_CARD, PASSPORT, DRIVERS, SELFIE
  country         String?                  // ISO 3166-1 alpha-3
  reviewStatus    String                   // Sumsub review status for this doc
  metadata        Json?                    // Extracted OCR fields (masked)
  createdAt       DateTime    @default(now())

  @@index([applicantId])
}

// Tracks AML screening results for re-screening triggers
model KycAmlScreen {
  id              Int         @id @default(autoincrement())
  applicantId     Int                      // FK to KycApplicant.id
  sumsubAmlId     String      @unique     // Sumsub AML check ID
  result          Json                     // Full AML screening result
  totalHits       Int         @default(0)
  reviewedBy      String?                  // Admin who reviewed hits (nullable)
  reviewedAt      DateTime?
  createdAt       DateTime    @default(now())

  @@index([applicantId])
  @@index([createdAt])
}

// PII audit log — records who accessed what PII and when
model KycPiiAccessLog {
  id              Int         @id @default(autoincrement())
  applicantId     Int
  accessedBy      String                   // Admin user ID or system
  fieldsAccessed  String[]                 // List of fields accessed
  reason          String                   // e.g., "manual_review", "support_request"
  createdAt       DateTime    @default(now())

  @@index([applicantId])
  @@index([createdAt])
}
```

### Relationships & Existing Schema Integration

The existing `Invoice` model already has `farmer` and `investor` fields (string wallet addresses). The `KycApplicant.userId` field should reference these wallet public keys.

---

## API Flow: Onboarding & Verification

### Step 1: User Initiates KYC

```
User (Frontend) → Backend: POST /api/kyc/init
  Body: { level: "STANDARD" }
  
Backend → Sumsub: POST /resources/applicants
  Body: { externalUserId: "<wallet_address>" }
  
Backend → Sumsub: POST /resources/applicants/{id}/status/pending
  (moves applicant to pending, enables document upload)
  
Backend → Sumsub: POST /resources/accessTokens
  Body: { userId: "<sumsub_applicant_id>", levelName: "standard" }
  
Backend → Frontend: { token: "<access_token>", applicantId: "<id>" }
```

### Step 2: User Completes Verification (Client-Side)

```tsx
// In frontend: KYC onboarding component
import SumsubWebSdk from '@sumsub/websdk-react';

function KycOnboarding({ accessToken, applicantId }) {
  return (
    <SumsubWebSdk
      accessToken={accessToken}
      applicantId={applicantId}
      onMessage={(type, payload) => {
        if (type === 'idCheck.onApplicantReviewed') {
          // Verification complete — backend will also receive webhook
        }
      }}
      options={{ lang: 'en' }}
    />
  );
}
```

### Step 3: Webhook Processing (Server-Side)

Sumsub sends `applicantReviewed` webhook → Backend processes it (see [Webhook Event Handling](#webhook-event-handling)).

### Step 4: Post-Verification

```
Backend → Frontend: GET /api/kyc/status
  Response: { status: "VERIFIED", level: "STANDARD", verifiedAt: "..." }
```

The frontend uses this to gate protocol interactions (e.g., investing above threshold requires STANDARD or ENHANCED KYC).

### API Endpoints

| Method | Path | Description | Auth |
|---|---|---|---|
| `POST` | `/api/kyc/init` | Create Sumsub applicant, return access token | JWT |
| `GET` | `/api/kyc/status` | Get current user's KYC status & level | JWT |
| `POST` | `/api/kyc/upgrade` | Request upgrade to higher verification level | JWT |
| `GET` | `/api/kyc/admin/applicants` | List applicants (admin) | JWT + Admin |
| `GET` | `/api/kyc/admin/applicants/:id` | Get full applicant details (admin) | JWT + Admin |
| `POST` | `/api/kyc/webhook` | Receive Sumsub webhooks | HMAC Sig |
| `POST` | `/api/kyc/aml/rescreen` | Trigger manual AML re-screen (admin) | JWT + Admin |

---

## Webhook Event Handling

### Sumsub Webhook Events to Handle

| Event | Trigger | Action |
|---|---|---|
| `applicantCreated` | New applicant created in Sumsub | Audit log; no DB change needed |
| `applicantPending` | Applicant moved to pending status | Update `KycApplicant.status = PENDING` |
| `applicantReviewed` | Verification review completed | Update status to VERIFIED/REJECTED; cache review result; update `verifiedAt`/`expiresAt`; log PII access |
| `applicantLevelChanged` | Verification level changed | Update `KycApplicant.level` |
| `applicantReset` | Applicant reset (re-verification) | Update status to RESET; archive old data |
| `applicantDeleted` | Applicant deleted in Sumsub | Mark for PII deletion; schedule data purge |

### Webhook Handler Implementation

```typescript
// kyc.webhook.controller.ts
@Controller('api/kyc/webhook')
export class KycWebhookController {
  constructor(private readonly kycService: KycService) {}

  @Post()
  async handleWebhook(
    @Headers('x-payload-digest') digest: string,
    @Headers('x-payload-timestamp') timestamp: string,
    @Body() payload: SumsubWebhookPayload,
  ) {
    // 1. Verify HMAC signature
    this.kycService.verifyWebhookSignature(digest, timestamp, payload);

    // 2. Store raw event for audit trail
    await this.kycService.storeKycEvent(payload);

    // 3. Process event by type
    switch (payload.type) {
      case 'applicantReviewed':
        await this.kycService.handleApplicantReviewed(payload);
        break;
      case 'applicantPending':
        await this.kycService.handleApplicantPending(payload);
        break;
      case 'applicantLevelChanged':
        await this.kycService.handleLevelChanged(payload);
        break;
      case 'applicantReset':
        await this.kycService.handleApplicantReset(payload);
        break;
      // ... other cases
    }
  }
}
```

### Security Considerations

- Webhook endpoint is **unauthenticated** (no JWT) but verified via **HMAC signature** (Sumsub signs with your secret key).
- Validate `x-payload-digest` header against SHA-256 hash of payload + timestamp.
- Reject webhooks with timestamps older than 5 minutes (replay protection).
- Store `KycEvent` row for every webhook received (immutable audit trail).

---

## Re-KYC Trigger Logic

Ongoing monitoring and periodic re-verification are required for regulatory compliance. The following triggers should prompt re-KYC:

### Trigger Conditions

| Trigger | Condition | Action |
|---|---|---|
| **Periodic expiry** | `KycApplicant.expiresAt < now()` | Notify user; if not re-verified within 30 days, downgrade to `NOT_STARTED` and restrict protocol actions |
| **Level upgrade** | User wants to invest above current level threshold | Trigger next-level verification flow |
| **AML adverse hit** | Periodic AML re-screen returns new PEP/sanctions match | Flag account; manual review; potentially freeze funds |
| **Risk score change** | Sumsub risk score exceeds configurable threshold | Trigger enhanced verification |
| **Regulatory change** | New jurisdiction rules require additional data | Push re-verification to affected users |
| **Suspicious activity** | Unusual transaction pattern detected | Trigger enhanced due diligence (EDD) |
| **Data breach / compromise** | User reports account compromise | Reset verification; require re-verification with new documents |

### Re-KYC Scheduler

A NestJS `@Cron` job runs daily to check for expired verifications:

```typescript
// kyc-reminder.processor.ts (following existing invoice-reminder pattern)
@Injectable()
export class KycReverifyScheduler {
  constructor(private readonly kycService: KycService) {}

  @Cron('0 6 * * *') // Daily at 06:00 UTC
  async handleExpiredVerifications() {
    const expired = await this.kycService.findExpiredVerifications();
    for (const applicant of expired) {
      await this.kycService.initiateReverification(applicant);
    }
  }

  @Cron('0 2 * * 1') // Weekly on Monday at 02:00 UTC
  async handlePeriodicAmlRescreen() {
    const dueForRescreen = await this.kycService.findDueForAmlRescreen();
    for (const applicant of dueForRescreen) {
      await this.kycService.triggerAmlRescreen(applicant);
    }
  }
}
```

---

## Graceful Degradation

If the Sumsub API is unavailable, InvoiceFi must degrade gracefully rather than blocking all protocol activity.

### Degradation Strategy

| Scenario | Impact | Fallback Behavior |
|---|---|---|
| **Sumsub API down during onboarding** | New KYC cannot be initiated | Accept user registration; queue KYC for later; allow limited protocol use (LIGHT level equivalent) for ≤ 7 days |
| **Sumsub API down during verification** | Pending verifications stall | Display "verification delayed" message; periodic retry with exponential backoff (see existing `retry.ts` utility) |
| **Webhook delivery delayed** | Status not updated in real-time | Poll Sumsub status API every 15 minutes as fallback; reconcile webhook gaps |
| **Sumsub extended outage (>24h)** | Protocol cannot verify new users | Activate emergency mode: restrict new high-value transactions; notify existing verified users; display status page |
| **AML screening unavailable** | New transactions cannot be screened | Block high-value transactions; allow low-value with post-facto screening; log all unscreened transactions |

### Retry Strategy

Use the existing `backend/src/common/retry.ts` utility for Sumsub API calls:

```typescript
// kyc.service.ts
import { withRetry } from '../common/retry';

async createApplicant(data: CreateApplicantDto): Promise<SumsubApplicant> {
  return withRetry(
    () => this.sumsubClient.createApplicant(data),
    { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 10000 }
  );
}
```

### Circuit Breaker (Future Enhancement)

For a production deployment, add a circuit breaker pattern:
- After N consecutive failures, open the circuit (stop calling Sumsub).
- After a cooldown period, try a single request as a health check.
- If the health check succeeds, close the circuit and resume normal operations.

---

## Privacy Considerations & PII Handling

### Data Minimization Principle

InvoiceFi should store the **minimum PII necessary** for compliance. Sumsub stores the full verification data (documents, biometrics); InvoiceFi's database should store only references and status.

### What PII Is Stored Where

| Data | Stored in Sumsub | Stored in InvoiceFi DB | Justification |
|---|---|---|---|
| Full name | ✅ | ❌ (not stored) | Retrieved on-demand via Sumsub API if needed for audit |
| Date of birth | ✅ | ❌ (not stored) | Same as above |
| Government ID images | ✅ | ❌ (never downloaded) | Stored only in Sumsub; InvoiceFi never retrieves images |
| Selfie / biometric data | ✅ | ❌ (never downloaded) | Stored only in Sumsub |
| Wallet address (public key) | ✅ | ✅ (`KycApplicant.userId`) | Required for protocol operation; not PII per se |
| Verification status | ✅ | ✅ (`KycApplicant.status`) | Required for protocol gating |
| Verification level | ✅ | ✅ (`KycApplicant.level`) | Required for tiered access |
| Country of residence | ✅ | ✅ (in reviewResult JSON) | Required for jurisdiction risk assessment |
| AML screening results | ✅ | ✅ (`KycAmlScreen.result`) | Required for compliance audit trail |
| Risk score | ✅ | ✅ (`KycApplicant.riskScore`) | Required for risk-based decisions |
| Email address | N/A | ✅ (in User model, if exists) | Required for notifications |
| IP address | ✅ (via Sumsub Device Intelligence) | ❌ (not stored) | Transient; Sumsub uses for fraud detection |

### Data Retention Policy

| Data Category | Retention Period | Deletion Procedure |
|---|---|---|
| **KYC verification status & level** | Duration of user account + 5 years after account closure | Delete from `KycApplicant` table upon account deletion + retention period |
| **Sumsub applicant ID reference** | Same as above | Delete from InvoiceFi DB; request deletion from Sumsub via API (`DELETE /resources/applicants/{id}`) |
| **AML screening results** | 5 years from date of screen (per AMLD6) | Purge `KycAmlScreen` records; also request deletion from Sumsub |
| **Webhook event logs** | 2 years (operational audit) | Purge `KycEvent` records |
| **PII access logs** | 3 years | Purge `KycPiiAccessLog` records |
| **Sumsub-stored documents/biometrics** | Per Sumsub's policy (typically 5 years after last activity) | Request via Sumsub API or support ticket; governed by DPA |

### Data Deletion Procedures

**User-Requested Deletion (GDPR/CCPA Right to Erasure):**

1. User submits deletion request via privacy portal or support.
2. Backend identifies user's `KycApplicant` record.
3. Call Sumsub API: `PATCH /resources/applicants/{id}` to deactivate (anonymize PII in Sumsub).
4. Delete all InvoiceFi DB records: `KycApplicant`, `KycDocument`, `KycAmlScreen`, `KycEvent`, `KycPiiAccessLog`.
5. Log deletion for audit (retain only: timestamp, action, anonymized reference).

**Automated Retention-Based Purge:**

Monthly cron job (`@Cron('0 3 1 * *')`) that:
1. Identifies records past retention period.
2. Calls Sumsub API to request data deletion where applicable.
3. Purges local DB records.
4. Logs purge actions to a dedicated audit table.

### Data Residency

- Sumsub data processing region should be configured to **Frankfurt (EU)** for European users and **US** for US users, based on the user's jurisdiction.
- This is configured at the Sumsub applicant level: specify `"region": "eu"` or `"region": "us"` in the applicant creation request.
- All InvoiceFi backend infrastructure should maintain the same regional alignment for PII storage.

### Data Processing Agreement (DPA)

A DPA must be executed with Sumsub before processing any PII in production. Sumsub provides a standard DPA that covers:
- Data processor obligations under GDPR Article 28
- Standard Contractual Clauses (SCCs) for international transfers
- Sub-processor disclosures
- Data breach notification procedures
- Audit rights

### Security Controls

- All communication with Sumsub API over HTTPS/TLS 1.3.
- Sumsub API credentials stored in environment variables (never in code/config files).
- Webhook HMAC signature verification enforced.
- PII access logging (`KycPiiAccessLog`) for all administrative access.
- Principle of least privilege: only `kyc-service` module has Sumsub API credentials.
- Regular security review of KYC module access patterns.

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1–2)
- [ ] Create `kyc` NestJS module with basic structure
- [ ] Implement `SumsubClient` (HTTP client with authentication)
- [ ] Add Prisma schema changes, run migration
- [ ] Set up Sumsub sandbox account and test credentials
- [ ] Implement `POST /api/kyc/init` and `GET /api/kyc/status`

### Phase 2: Webhooks & Verification Flow (Week 3–4)
- [ ] Implement webhook endpoint with HMAC verification
- [ ] Handle `applicantReviewed`, `applicantPending`, `applicantLevelChanged`
- [ ] Integrate Sumsub WebSDK in frontend
- [ ] End-to-end test in sandbox: init → verify → webhook → status update

### Phase 3: Re-KYC & AML (Week 5–6)
- [ ] Implement re-KYC scheduler (expiry checks)
- [ ] Add periodic AML re-screening cron job
- [ ] Implement KYC gating in protocol operations (investment limits by level)
- [ ] Build admin dashboard for KYC applicant review

### Phase 4: Hardening (Week 7–8)
- [ ] Graceful degradation (circuit breaker, retry)
- [ ] PII access logging
- [ ] Data retention purge job
- [ ] DPA execution with Sumsub
- [ ] Production go-live checklist and runbook

---

## Appendix A: Sumsub API Authentication

Sumsub uses HMAC-based request signing (not API keys in headers):

```
X-App-Token: <base64(URL-safe-json-of-{method,url,ts})>.<hex(HMAC-SHA256)>
X-App-Access-Ts: <unix_timestamp_seconds>
```

Implementation reference in `backend/src/kyc/sumsub/sumsub.signature.ts`.

## Appendix B: Environment Variables

```env
# Sumsub Integration
SUMSUB_API_URL=https://api.sumsub.com
SUMSUB_APP_TOKEN=your_app_token
SUMSUB_SECRET_KEY=your_secret_key
SUMSUB_WEBHOOK_SECRET=your_webhook_secret
SUMSUB_DEFAULT_REGION=eu
SUMSUB_WEBHOOK_BASE_URL=https://api.invoicefi.io
```

## Appendix C: References

- [Sumsub API Reference](https://docs.sumsub.com/reference/about-sumsub-api)
- [Sumsub User Verification Guide](https://docs.sumsub.com/docs/user-verification)
- [Sumsub Webhooks Documentation](https://docs.sumsub.com/docs/webhooks)
- [Sumsub Crypto Transactions (Chainalysis)](https://docs.sumsub.com/reference/chainalysis-crypto-transactions)
- [Sumsub Travel Rule](https://docs.sumsub.com/docs/travel-rule-overview)
- [FATF Recommendation 15 — Virtual Assets](https://www.fatf-gafi.org/en/topics/virtual-assets.html)
- [EU MiCA Regulation](https://eur-lex.europa.eu/eli/reg/2023/1114)
