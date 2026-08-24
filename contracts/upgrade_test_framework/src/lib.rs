//! Shared helpers and v2 test-double contract definitions for upgrade
//! regression tests across all three InvoiceFi contracts.
//!
//! # Pattern
//!
//! Each v2 test-double is a purpose-built additive extension of the matching
//! v1 contract. The doubles live here rather than in the production crates to
//! keep the production source clean. They add:
//!
//! - A `version() -> u32` view that returns `2`.
//! - An admin-only `upgrade(new_wasm: BytesN<32>)` entry point that calls
//!   `env.update_current_contract_wasm(new_wasm)`.
//!
//! All state layout (storage keys, types, encodings) is identical to v1, so
//! the post-upgrade reads exercise real backward-compatibility.
//!
//! # Usage
//!
//! ```rust
//! use upgrade_test_framework::helpers::*;
//! ```

pub mod helpers;
pub mod v2_invoice;
pub mod v2_financing_pool;
pub mod v2_settlement;
