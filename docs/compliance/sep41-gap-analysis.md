# SEP-41 Token Standard Gap Analysis: Invoice Contract

## Overview
This document evaluates the `contracts/invoice` Soroban smart contract against the Stellar Ecosystem Proposal **SEP-41** (Token Interface Standard). 

## SEP-41 Requirement Checklist & Status

| Requirement / Method | Status | Notes / Deviations |
|----------------------|--------|---------------------|
| `allowance(from, spender)` | ❌ Missing | Required for delegated spending. Needs implementation. |
| `approve(from, spender, amount, expiration)` | ❌ Missing | Required to authorize allowance limits. |
| `balance(id)` | ⚠️ Partial | Exists, but signature requires adjustment to match SEP-41 return semantics. |
| `decimals()` | ❌ Missing | Required token metadata function. |
| `name()` | ❌ Missing | Required token metadata function. |
| `symbol()` | ❌ Missing | Required token metadata function. |
| `transfer(from, to, amount)` | ✅ Implemented | Core transfer logic present, needs event emission check. |
| `transfer_from(spender, from, to, amount)` | ❌ Missing | Required for token transfer via allowance. |
| **Event Emissions** | ⚠️ Partial | Missing standardized `Transfer`, `Approval`, and `Mint`/`Burn` topics. |

## Action Plan
1. Implement missing mandatory functions (`allowance`, `approve`, `decimals`, `name`, `symbol`, `transfer_from`).
2. Standardize event logging to conform strictly with SEP-41 spec.
3. Establish automated Rust integration tests utilizing standard SEP-41 verification vectors.
