//! Upgrade regression tests for the Invoice contract.
//!
//! # Pattern
//!
//! Each test:
//! 1. Deploys the **current** invoice contract (v1) and plants a specific
//!    state pattern via v1 entry points.
//! 2. Registers the v2 test-double at the **same address**, simulating the
//!    WASM-level upgrade that `env.deployer().update_current_contract_wasm`
//!    would perform on-chain.
//! 3. Opens a v2 client at the same address and asserts every planted state
//!    value is intact and behaviorally correct.
//!
//! No network is involved; the soroban-sdk `Env` sandbox shares persistent
//! storage across re-registrations at the same contract address.

#![cfg(test)]

use soroban_sdk::{
    symbol_short,
    testutils::Address as _,
    Address, Env, String,
};

use crate::{
    Error, InvoiceContract, InvoiceContractClient, Status,
    MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

struct V1Harness<'a> {
    env: Env,
    contract_id: Address,
    client: InvoiceContractClient<'a>,
    admin: Address,
}

fn deploy_v1() -> V1Harness<'static> {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(InvoiceContract, ());
    let client = InvoiceContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let mut signers = soroban_sdk::Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&signers, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);
    // SAFETY: We intentionally extend the lifetime here because the Env is
    // owned by V1Harness which outlives the borrow.
    let client: InvoiceContractClient<'static> = unsafe {
        core::mem::transmute(client)
    };
    V1Harness { env, contract_id, client, admin }
}

const DUE_DATE: u64 = 1_900_000_000;
const DISCOUNT_RATE: u32 = 500; // 5%

fn mint_pending(h: &V1Harness, owner: &Address) -> u64 {
    h.client.mint(
        owner,
        &2_000i128,
        &symbol_short!("MAIZE"),
        &DUE_DATE,
        &String::from_str(&h.env, "ipfs://upgrade-test"),
    )
}

fn mint_and_fund(h: &V1Harness, owner: &Address) -> u64 {
    let id = mint_pending(h, owner);
    h.client.fund(&h.admin, &id, &DISCOUNT_RATE);
    id
}

// ── Simulate WASM upgrade ──────────────────────────────────────────────────────
//
// The soroban test sandbox does not support uploading and swapping real compiled
// WASM blobs during a single test run.  What it *does* support is registering a
// different Rust type at the same Address — which is precisely what an on-chain
// upgrade does: it replaces the executing WASM while the persistent ledger state
// (keyed by the contract address) remains untouched.
//
// `simulate_upgrade_to_v2` re-registers the v2 contract at `contract_id` so that
// subsequent calls go through v2 entry points while reading the same storage.

use upgrade_test_framework::v2_invoice::InvoiceContractV2;
use upgrade_test_framework::v2_invoice::InvoiceContractV2Client;

fn simulate_upgrade_to_v2<'a>(
    env: &'a Env,
    contract_id: &Address,
) -> InvoiceContractV2Client<'a> {
    env.register_at(contract_id, InvoiceContractV2, ());
    InvoiceContractV2Client::new(env, contract_id)
}

// ══════════════════════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════════════════════

/// After upgrading the WASM, a Pending invoice planted in v1 must be readable
/// via v2 entry points with all fields intact.
#[test]
fn upgrade_preserves_pending_invoice() {
    let h = deploy_v1();
    let owner = Address::generate(&h.env);
    let id = mint_pending(&h, &owner);

    // ── Sanity-check v1 state ─────────────────────────────────────────────────
    let inv_v1 = h.client.get_invoice(&id);
    assert_eq!(inv_v1.status, Status::Pending);
    assert_eq!(inv_v1.owner, owner);
    assert_eq!(inv_v1.amount, 2_000);

    // ── Upgrade ───────────────────────────────────────────────────────────────
    let v2 = simulate_upgrade_to_v2(&h.env, &h.contract_id);

    // ── Post-upgrade invariants ───────────────────────────────────────────────
    assert_eq!(v2.version(), 2, "version() should return 2 after upgrade");

    let inv_v2 = v2.get_invoice(&id);
    assert_eq!(inv_v2.id, id,       "id mismatch after upgrade");
    assert_eq!(inv_v2.owner, owner, "owner mismatch after upgrade");
    assert_eq!(inv_v2.amount, 2_000, "amount mismatch after upgrade");
    assert_eq!(inv_v2.due_date, DUE_DATE, "due_date mismatch after upgrade");
    assert_eq!(
        inv_v2.status,
        upgrade_test_framework::v2_invoice::Status::Pending,
        "status must still be Pending after upgrade"
    );
    assert_eq!(
        inv_v2.crop,
        symbol_short!("MAIZE"),
        "crop must survive upgrade"
    );

    // Counter must survive.
    assert_eq!(v2.total_minted(), 1, "total_minted() mismatch after upgrade");
}

/// A funded invoice (Funded status + ownership token) survives the upgrade
/// with all token metadata intact.
#[test]
fn upgrade_preserves_funded_invoice() {
    let h = deploy_v1();
    let owner = Address::generate(&h.env);
    let id = mint_and_fund(&h, &owner);

    assert_eq!(h.client.status_of(&id), Status::Funded);
    assert!(h.client.is_tokenized(&id));
    let token_v1 = h.client.get_invoice_token(&id);

    // ── Upgrade ───────────────────────────────────────────────────────────────
    let v2 = simulate_upgrade_to_v2(&h.env, &h.contract_id);

    // ── Post-upgrade invariants ───────────────────────────────────────────────
    assert!(v2.is_tokenized(&id), "invoice must still be tokenized after upgrade");
    assert_eq!(
        v2.status_of(&id),
        upgrade_test_framework::v2_invoice::Status::Funded,
        "status must be Funded after upgrade"
    );

    let token_v2 = v2.get_invoice_token(&id);
    assert_eq!(token_v2.invoice_id, token_v1.invoice_id, "token.invoice_id mismatch");
    assert_eq!(token_v2.face_value, token_v1.face_value, "token.face_value mismatch");
    assert_eq!(token_v2.discount_rate, token_v1.discount_rate, "token.discount_rate mismatch");
    assert_eq!(token_v2.due_date, token_v1.due_date, "token.due_date mismatch");

    // Ownership query survives.
    assert_eq!(v2.owner_of(&id), owner, "owner must survive upgrade");
}

/// A Settled (fully-repaid) invoice's terminal status and transfer-block
/// survive the upgrade.
#[test]
fn upgrade_preserves_settled_invoice() {
    let h = deploy_v1();
    let owner = Address::generate(&h.env);
    let id = mint_and_fund(&h, &owner);
    h.client.update_status(&h.admin, &id, &Status::Settled);

    let v2 = simulate_upgrade_to_v2(&h.env, &h.contract_id);

    assert_eq!(
        v2.status_of(&id),
        upgrade_test_framework::v2_invoice::Status::Settled,
        "Settled status must persist through upgrade"
    );
    // Transfer must still be blocked.
    let buyer = Address::generate(&h.env);
    assert_eq!(
        v2.try_transfer(&owner, &buyer, &id),
        Err(Ok(crate::Error::TransferAfterRepayment)),
        "TransferAfterRepayment must still be enforced post-upgrade"
    );
}

/// A Defaulted invoice's terminal status survives the upgrade.
#[test]
fn upgrade_preserves_defaulted_invoice() {
    let h = deploy_v1();
    let owner = Address::generate(&h.env);
    let id = mint_pending(&h, &owner);
    h.client.update_status(&h.admin, &id, &Status::Defaulted);

    let v2 = simulate_upgrade_to_v2(&h.env, &h.contract_id);

    assert_eq!(
        v2.status_of(&id),
        upgrade_test_framework::v2_invoice::Status::Defaulted,
        "Defaulted status must persist through upgrade"
    );
    // Further transitions must still be rejected.
    assert!(
        v2.try_update_status(&h.admin, &id, &upgrade_test_framework::v2_invoice::Status::Funded).is_err(),
        "Defaulted is terminal — further transitions must be rejected post-upgrade"
    );
}

/// An approval record planted in v1 survives the upgrade and can still be used
/// in a `transfer_from` call post-upgrade.
#[test]
fn upgrade_preserves_approval() {
    let h = deploy_v1();
    let owner = Address::generate(&h.env);
    let spender = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    let id = mint_and_fund(&h, &owner);
    h.client.approve(&owner, &spender, &id);

    let v2 = simulate_upgrade_to_v2(&h.env, &h.contract_id);

    // Approval is still there.
    assert_eq!(v2.get_approved(&id), spender, "approval must survive upgrade");

    // transfer_from still works using the pre-upgrade approval.
    v2.transfer_from(&spender, &owner, &buyer, &id)
        .expect("transfer_from must succeed using pre-upgrade approval");
    assert_eq!(v2.owner_of(&id), buyer, "owner must be buyer after transfer_from");
    // Approval consumed.
    assert_eq!(
        v2.try_get_approved(&id),
        Err(Ok(crate::Error::NotApproved)),
        "approval must be consumed on transfer_from"
    );
}

/// The invoice counter and admin signer set (multisig config) both survive
/// the upgrade.
#[test]
fn upgrade_preserves_counter_and_multisig() {
    let h = deploy_v1();
    let owner = Address::generate(&h.env);
    // Mint three invoices before upgrading.
    for _ in 0..3 {
        mint_pending(&h, &owner);
    }
    assert_eq!(h.client.total_minted(), 3);

    let v2 = simulate_upgrade_to_v2(&h.env, &h.contract_id);

    assert_eq!(v2.total_minted(), 3, "counter must survive upgrade");
    assert!(v2.is_signer(&h.admin), "admin signer must survive upgrade");
}

/// A LiquidityManager role grant from v1 survives the upgrade; the grantee
/// can still call `fund` after the upgrade.
#[test]
fn upgrade_preserves_role_grants() {
    let h = deploy_v1();
    let lm = Address::generate(&h.env);
    let owner = Address::generate(&h.env);

    // Grant the role in v1.
    h.client.grant_role(&h.admin, &crate::access_control::Role::LiquidityManager, &lm);
    let id = mint_pending(&h, &owner);

    let v2 = simulate_upgrade_to_v2(&h.env, &h.contract_id);

    // Role must still be present.
    assert!(
        v2.has_role(&access_control::Role::LiquidityManager, &lm),
        "LiquidityManager role must survive upgrade"
    );
    // Grantee must still be able to fund.
    v2.fund(&lm, &id, &DISCOUNT_RATE)
        .expect("LiquidityManager must still be able to fund after upgrade");
    assert_eq!(
        v2.status_of(&id),
        upgrade_test_framework::v2_invoice::Status::Funded
    );
}

/// The paused state from v1 survives the upgrade; mint is still rejected.
#[test]
fn upgrade_preserves_paused_state() {
    let h = deploy_v1();
    h.client.pause(&h.admin);
    assert!(h.client.is_paused());

    let v2 = simulate_upgrade_to_v2(&h.env, &h.contract_id);

    assert!(v2.is_paused(), "paused state must survive upgrade");
    let owner = Address::generate(&h.env);
    assert_eq!(
        v2.try_mint(
            &owner,
            &1_000i128,
            &symbol_short!("MAIZE"),
            &DUE_DATE,
            &String::from_str(&h.env, "ipfs://x"),
        ),
        Err(Ok(crate::Error::ContractPaused)),
        "mint must still be blocked while paused after upgrade"
    );
}

/// Multiple invoices across different lifecycle stages all survive the upgrade.
/// This is the "mixed-state garden" test.
#[test]
fn upgrade_preserves_mixed_state_garden() {
    let h = deploy_v1();
    let owner1 = Address::generate(&h.env);
    let owner2 = Address::generate(&h.env);
    let owner3 = Address::generate(&h.env);

    // Plant three state patterns required by the acceptance criteria.
    let pending_id  = mint_pending(&h, &owner1);
    let funded_id   = mint_and_fund(&h, &owner2);
    let settled_id  = mint_and_fund(&h, &owner3);
    h.client.update_status(&h.admin, &settled_id, &Status::Settled);

    let v2 = simulate_upgrade_to_v2(&h.env, &h.contract_id);

    assert_eq!(v2.status_of(&pending_id),
        upgrade_test_framework::v2_invoice::Status::Pending);
    assert_eq!(v2.status_of(&funded_id),
        upgrade_test_framework::v2_invoice::Status::Funded);
    assert_eq!(v2.status_of(&settled_id),
        upgrade_test_framework::v2_invoice::Status::Settled);

    assert_eq!(v2.total_minted(), 3, "counter must reflect all minted invoices");
    assert!(v2.is_tokenized(&funded_id), "funded invoice must still be tokenized");
    assert!(v2.is_tokenized(&settled_id), "settled invoice must still be tokenized");
}
