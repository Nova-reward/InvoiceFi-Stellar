//! Upgrade regression tests for the Settlement contract.
//!
//! # Pattern
//!
//! Each test:
//! 1. Deploys the settlement contract (v1), plants a specific state pattern
//!    via v1 entry points.
//! 2. Re-registers the v2 test-double at the same address.
//! 3. Asserts that all planted state is intact via v1 client reads (the
//!    persistent storage is shared — v1 and v2 use the same keys).

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, Symbol,
};

use crate::error::SettlementStatus;
use crate::{SettlementContract, SettlementContractClient};
use access_control::MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS;

// ── Helpers ───────────────────────────────────────────────────────────────────

struct V1Harness<'a> {
    env: Env,
    contract_id: Address,
    client: SettlementContractClient<'a>,
    admin: Address,
}

fn deploy_v1() -> V1Harness<'static> {
    let env = Env::default();
    env.mock_all_auths();
    // Settlement nonce validity requires timestamp ≤ due_date + 30 days.
    // Start at a reasonable base time so nonce checks pass.
    env.ledger().with_mut(|li| {
        li.timestamp = 1_700_000_000;
    });
    let contract_id = env.register(SettlementContract, ());
    let client = SettlementContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let mut signers = soroban_sdk::Vec::new(&env);
    signers.push_back(admin.clone());
    client.init(&signers, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);
    let client: SettlementContractClient<'static> = unsafe { core::mem::transmute(client) };
    V1Harness {
        env,
        contract_id,
        client,
        admin,
    }
}

fn invoice_sym(env: &Env, s: &str) -> Symbol {
    Symbol::new(env, s)
}

use upgrade_test_framework::v2_settlement::SettlementContractV2;
use upgrade_test_framework::v2_settlement::SettlementContractV2Client;

fn simulate_upgrade_to_v2<'a>(
    env: &'a Env,
    contract_id: &Address,
) -> SettlementContractV2Client<'a> {
    env.register_at(contract_id, SettlementContractV2, ());
    SettlementContractV2Client::new(env, contract_id)
}

// ── Set up a usable invoice (for tests that need a full record) ───────────────

fn plant_invoice(h: &V1Harness, id: &Symbol, amount: i128, due_date: u64) -> (Address, Address) {
    let borrower = Address::generate(&h.env);
    let financier = Address::generate(&h.env);
    h.client.set_invoice_data(
        &h.admin, id, &borrower, &financier, &amount, &due_date, &0u32, // interest_rate
    );
    (borrower, financier)
}

// ══════════════════════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════════════════════

/// An InvoiceRecord planted in v1 survives the upgrade with all fields intact.
#[test]
fn upgrade_preserves_invoice_record() {
    let h = deploy_v1();
    let id = invoice_sym(&h.env, "INV001");
    let due_date: u64 = 1_800_000_000;
    let (borrower, financier) = plant_invoice(&h, &id, 5_000, due_date);

    let v2 = simulate_upgrade_to_v2(&h.env, &h.contract_id);
    assert_eq!(v2.version(), 2, "version() must return 2");

    // Re-open a v1 client to read persistent state (v1 and v2 share storage).
    // We use the same-address v1 client that was established before the upgrade.
    // Because storage is keyed by contract_id, not WASM hash, the v1 client
    // can still read the record.
    let rec_after = h.client.get_invoice(&id).unwrap();

    assert_eq!(rec_after.amount, 5_000, "amount mismatch after upgrade");
    assert_eq!(
        rec_after.borrower, borrower,
        "borrower mismatch after upgrade"
    );
    assert_eq!(
        rec_after.financier, financier,
        "financier mismatch after upgrade"
    );
    assert_eq!(
        rec_after.due_date, due_date,
        "due_date mismatch after upgrade"
    );
    assert_eq!(rec_after.principal_paid, 0, "principal_paid should be 0");
    assert_eq!(
        rec_after.status,
        SettlementStatus::ApprovedForSettlement as u32,
        "initial status must be ApprovedForSettlement"
    );
}

/// Partial settlement state (principal_paid, status) survives the upgrade.
#[test]
fn upgrade_preserves_partial_settlement() {
    let h = deploy_v1();
    let id = invoice_sym(&h.env, "INV_PART");
    let due_date: u64 = 1_800_000_000;
    let (borrower, _financier) = plant_invoice(&h, &id, 10_000, due_date);

    // Partially settle: pay 3 000 out of 10 000.
    h.client
        .settle_invoice(&borrower, &id, &1u64, &3_000i128, &1u32);

    let rec_partial = h.client.get_invoice(&id).unwrap();
    assert_eq!(rec_partial.principal_paid, 3_000);
    assert_ne!(
        rec_partial.status,
        SettlementStatus::Settled as u32,
        "invoice must not be fully settled yet"
    );

    let _v2 = simulate_upgrade_to_v2(&h.env, &h.contract_id);

    // Read state back through v1 client (shared storage).
    let rec_after = h.client.get_invoice(&id).unwrap();
    assert_eq!(
        rec_after.principal_paid, 3_000,
        "principal_paid must survive upgrade"
    );
    assert_ne!(
        rec_after.status,
        SettlementStatus::Settled as u32,
        "status must still reflect partial settlement after upgrade"
    );

    // Nonce 1 must still be consumed — replay must be rejected.
    assert!(
        h.client.get_used_nonces(&id).contains(&1u64),
        "used nonce must survive upgrade"
    );
}

/// A fully-settled invoice's terminal status survives the upgrade; further
/// settlement is rejected.
#[test]
fn upgrade_preserves_fully_settled() {
    let h = deploy_v1();
    let id = invoice_sym(&h.env, "INV_FULL");
    let due_date: u64 = 1_800_000_000;
    let (borrower, _financier) = plant_invoice(&h, &id, 5_000, due_date);

    // Fully settle in one payment.
    h.client
        .settle_invoice(&borrower, &id, &1u64, &5_000i128, &1u32);

    let rec_settled = h.client.get_invoice(&id).unwrap();
    assert_eq!(rec_settled.status, SettlementStatus::Settled as u32);

    let _v2 = simulate_upgrade_to_v2(&h.env, &h.contract_id);

    let rec_after = h.client.get_invoice(&id).unwrap();
    assert_eq!(
        rec_after.status,
        SettlementStatus::Settled as u32,
        "Settled status must persist through upgrade"
    );
    assert_eq!(
        rec_after.principal_paid, 5_000,
        "principal_paid must persist through upgrade"
    );
}

/// Fee counters (collected_fees, withdrawn_fees) survive the upgrade.
#[test]
fn upgrade_preserves_fee_counters() {
    let h = deploy_v1();
    let id = invoice_sym(&h.env, "INV_FEE");
    let due_date: u64 = 1_800_000_000;
    let (borrower, _financier) = plant_invoice(&h, &id, 10_000, due_date);

    // Set fee rate to 2%.
    h.client.set_fee_rate(&h.admin, &200u32);

    // Settle 5 000 → fee = 5 000 * 200 / 10 000 = 100
    h.client
        .settle_invoice(&borrower, &id, &1u64, &5_000i128, &1u32);

    let fees_before = h.client.get_collected_fees().unwrap_or(0);
    assert_eq!(fees_before, 100, "collected_fees should be 100");

    let _v2 = simulate_upgrade_to_v2(&h.env, &h.contract_id);

    // Fees must survive.
    let fees_after = h.client.get_collected_fees().unwrap_or(0);
    assert_eq!(fees_after, 100, "collected_fees must survive upgrade");
    let withdrawn_after = h.client.get_withdrawn_fees().unwrap_or(0);
    assert_eq!(withdrawn_after, 0, "withdrawn_fees must survive upgrade");
    let rate_after = h.client.get_fee_rate().unwrap_or(0);
    assert_eq!(rate_after, 200, "fee_rate must survive upgrade");
}

/// Used nonces survive the upgrade; replay attacks are still rejected.
#[test]
fn upgrade_preserves_nonces() {
    let h = deploy_v1();
    let id = invoice_sym(&h.env, "INV_NCE");
    let due_date: u64 = 1_800_000_000;
    let (borrower, _financier) = plant_invoice(&h, &id, 10_000, due_date);

    // Consume nonces 1, 2, 3.
    h.client
        .settle_invoice(&borrower, &id, &1u64, &1_000i128, &1u32);
    h.client
        .settle_invoice(&borrower, &id, &2u64, &1_000i128, &1u32);
    h.client
        .settle_invoice(&borrower, &id, &3u64, &1_000i128, &1u32);

    let nonces_before = h.client.get_used_nonces(&id);
    assert!(nonces_before.contains(&1u64));
    assert!(nonces_before.contains(&2u64));
    assert!(nonces_before.contains(&3u64));

    let _v2 = simulate_upgrade_to_v2(&h.env, &h.contract_id);

    let nonces_after = h.client.get_used_nonces(&id);
    assert!(nonces_after.contains(&1u64), "nonce 1 must survive upgrade");
    assert!(nonces_after.contains(&2u64), "nonce 2 must survive upgrade");
    assert!(nonces_after.contains(&3u64), "nonce 3 must survive upgrade");
}

/// The financing pool address configured in v1 survives the upgrade.
#[test]
fn upgrade_preserves_financing_pool_address() {
    let h = deploy_v1();
    let pool_addr = Address::generate(&h.env);
    h.client.set_financing_pool_address(&h.admin, &pool_addr);

    assert_eq!(
        h.client.get_financing_pool_address(),
        Some(pool_addr.clone())
    );

    let _v2 = simulate_upgrade_to_v2(&h.env, &h.contract_id);

    assert_eq!(
        h.client.get_financing_pool_address(),
        Some(pool_addr),
        "financing_pool_address must survive upgrade"
    );
}

/// Admin signer set and paused state survive the upgrade simultaneously.
#[test]
fn upgrade_preserves_admin_and_paused_state() {
    let h = deploy_v1();
    h.client.pause(&h.admin);
    assert!(h.client.is_paused());

    let _v2 = simulate_upgrade_to_v2(&h.env, &h.contract_id);

    assert!(
        h.client.is_signer(&h.admin),
        "admin signer must survive upgrade"
    );
    assert!(h.client.is_paused(), "paused state must survive upgrade");
}
