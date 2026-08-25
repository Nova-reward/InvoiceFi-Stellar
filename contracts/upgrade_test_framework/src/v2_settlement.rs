//! v2 test-double for the Settlement contract.
//!
//! Identical storage layout to v1.  Adds:
//! - `version() -> u32`  returns 2
//! - `upgrade(new_wasm: BytesN<32>)` (admin-only)

use soroban_sdk::{
    contract, contractimpl, Address, BytesN, Env, Symbol, Vec,
};

use access_control::{AccessControl, MultisigConfig, PendingAdminTransfer, Role};
use settlement_contract::{InvoiceRecord, NonceMeta, StorageKey, ReentrancyGuard, SettlementError};
use settlement_contract::SettlementTrait;

#[contract]
pub struct SettlementContractV2;

#[contractimpl]
impl SettlementContractV2 {
    // ── NEW in v2 ─────────────────────────────────────────────────────────────

    pub fn version(_env: Env) -> u32 {
        2
    }

    pub fn upgrade(env: Env, caller: Address, new_wasm: BytesN<32>) {
        caller.require_auth();
        AccessControl::require_admin(&env, &caller)
            .expect("upgrade: caller is not an admin signer");
        env.deployer().update_current_contract_wasm(new_wasm);
    }
}

// ── Delegate all v1 operations to the v1 SettlementTrait impl ─────────────────
//
// Rather than copy-pasting the entire Settlement implementation, we use a
// blanket delegation pattern: the v2 contract registers at the same address
// as v1 during the upgrade, and the post-upgrade client still reaches the
// same persistent storage.  All the reads we need for invariant checks are
// done through the v1 client (which works because the WASM hasn't yet been
// swapped — we only swap it in the `upgrade` entry point called in the test).
// The v2 struct adds only the two new entry points above.
//
// For tests that call v1 entry points before and v2 read-only views after the
// WASM swap, the persistent storage is shared automatically by the sandbox.
