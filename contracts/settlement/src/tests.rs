use super::{SettlementContract, SettlementStatus, SettlementTrait, StorageKey};
use crate::types::NonceMeta;
use access_control::MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS;
use soroban_sdk::{testutils::Address as _, Address, Env, Symbol, Vec};

fn signers_of(env: &Env, addrs: &[Address]) -> Vec<Address> {
    let mut v = Vec::new(env);
    for a in addrs {
        v.push_back(a.clone());
    }
    v
}

/// Single-signer (1-of-1) admin set, at the minimum allowed time-lock —
/// functionally equivalent to the old single-admin model.
fn init(e: &Env, admin: &Address) {
    let signers = signers_of(e, &[admin.clone()]);
    SettlementContract::init(e.clone(), signers, 1u32, MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);
}

#[test]
fn test_init_stores_admin() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);

    init(&e, &admin);

    assert!(SettlementContract::is_signer(e, admin));
}

#[test]
fn test_settle_invoice_requires_nonce() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let caller = Address::generate(&e);

    init(&e, &admin);

    let invoice_id = Symbol::new(&e, "INV-NONCE");
    SettlementContract::set_invoice_data(
        e.clone(),
        admin.clone(),
        invoice_id.clone(),
        caller.clone(),
        caller.clone(),
        5000,
        3000000000,
        500,
    );

    let deadline = 3000000000u64 + 2592000;
    let nm_key = StorageKey::nonce_meta(&invoice_id);
    let nm = NonceMeta::new(invoice_id.clone(), deadline);
    e.storage().persistent().set(&nm_key, &nm);

    // First call with nonce=1 should succeed (caller authenticated)
    SettlementContract::settle_invoice(
        e.clone(),
        caller.clone(),
        invoice_id.clone(),
        1,
        1000,
        0,
    );

    // Use nonce=1 again - should be rejected as replay
    SettlementContract::settle_invoice(e, caller, invoice_id, 1, 1000, 0);
}

#[test]
fn test_settle_invoice_with_valid_nonce() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let payer = Address::generate(&e);

    init(&e, &admin);

    let invoice_id = Symbol::new(&e, "INV-NONCE-OK");
    SettlementContract::set_invoice_data(
        e.clone(),
        admin.clone(),
        invoice_id.clone(),
        payer.clone(),
        payer.clone(),
        5000,
        5000000000,
        500,
    );

    let deadline = 5000000000u64 + 2592000;
    let nm_key = StorageKey::nonce_meta(&invoice_id);
    let nm = NonceMeta::new(invoice_id.clone(), deadline);
    e.storage().persistent().set(&nm_key, &nm);

    // First call - should succeed
    SettlementContract::settle_invoice(
        e.clone(),
        payer.clone(),
        invoice_id.clone(),
        99,
        5000,
        0,
    );

    let used = SettlementContract::get_used_nonces(e.clone(), invoice_id.clone());
    assert!(used.contains(&99));

    let rec = SettlementContract::get_invoice(e, invoice_id).unwrap();
    assert_eq!(rec.principal_paid, 5000);
}

#[test]
fn test_settle_without_nonce_meta_creates_it() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let borrower = Address::generate(&e);

    init(&e, &admin);

    let invoice_id = Symbol::new(&e, "INV-AUTO-NONCE");
    SettlementContract::set_invoice_data(
        e.clone(),
        admin.clone(),
        invoice_id.clone(),
        borrower.clone(),
        borrower.clone(),
        3000,
        5000000000,
        0, // zero fee rate
    );

    assert!(SettlementContract::get_used_nonces(e.clone(), invoice_id.clone()).is_empty());

    let deadline = 3000000000u64 + 2592000;
    let nm_key = StorageKey::nonce_meta(&invoice_id);
    let nm = NonceMeta::new(invoice_id.clone(), deadline);

    e.storage().persistent().set(&nm_key, &nm);

    // Borrower authenticates as caller and settles invoice
    SettlementContract::settle_invoice(e, borrower, invoice_id, 1, 3000, 0);
}

#[test]
#[should_panic(expected = "")]
fn test_nonce_replay_rejected() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let payer = Address::generate(&e);

    init(&e, &admin);

    let invoice_id = Symbol::new(&e, "INV-NONCE-REPLAY");
    SettlementContract::set_invoice_data(
        e.clone(),
        admin.clone(),
        invoice_id.clone(),
        payer.clone(),
        payer.clone(),
        5000,
        3900000000, // far future - nonce not expired
        500,
    );

    let deadline = 3900000000u64 + 2592000;
    let nm_key = StorageKey::nonce_meta(&invoice_id);
    let nm = NonceMeta::new(invoice_id.clone(), deadline);
    e.storage().persistent().set(&nm_key, &nm);

    // Use nonce 42 the first time - should succeed
    SettlementContract::settle_invoice(
        e.clone(),
        payer.clone(),
        invoice_id.clone(),
        42,
        5000,
        0,
    );

    // Use nonce 42 again - should be rejected as replay
    SettlementContract::settle_invoice(e, payer, invoice_id, 42, 5000, 0);
}

#[test]
#[should_panic(expected = "")]
fn test_settlement_nonce_expiry() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let payer = Address::generate(&e);

    init(&e, &admin);

    // due_date is far in the past - nonce already expired
    let due_date = 1000000000u64; // long past
    let invoice_id = Symbol::new(&e, "INV-NONCE-EXPIRED");
    SettlementContract::set_invoice_data(
        e.clone(),
        admin.clone(),
        invoice_id.clone(),
        payer.clone(),
        payer.clone(),
        5000,
        due_date,
        500,
    );

    let deadline = due_date + 2592000;
    let nm_key = StorageKey::nonce_meta(&invoice_id);
    let nm = NonceMeta::new(invoice_id.clone(), deadline);
    e.storage().persistent().set(&nm_key, &nm);

    let used: Vec<u64> = SettlementContract::get_used_nonces(e, invoice_id);
    assert!(used.is_empty());
}

#[test]
fn test_get_used_nonces_returns_list() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);

    init(&e, &admin);

    let invoice_id = Symbol::new(&e, "INV-NONCES");
    SettlementContract::set_invoice_data(
        e.clone(),
        admin.clone(),
        invoice_id.clone(),
        admin.clone(),
        admin.clone(),
        5000,
        5000000000,
        500,
    );

    let used = SettlementContract::get_used_nonces(e.clone(), invoice_id.clone());
    assert_eq!(used.len(), 0);
}

#[test]
fn test_settle_updates_principal() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let payer = Address::generate(&e);

    init(&e, &admin);

    let invoice_id = Symbol::new(&e, "INV-SETTLE");
    SettlementContract::set_invoice_data(
        e.clone(),
        admin.clone(),
        invoice_id.clone(),
        payer.clone(),
        payer.clone(),
        10000,
        5000000000,
        500,
    );

    let deadline = 5000000000u64 + 2592000;
    let nm_key = StorageKey::nonce_meta(&invoice_id);
    let nm = NonceMeta::new(invoice_id.clone(), deadline);
    e.storage().persistent().set(&nm_key, &nm);

    SettlementContract::settle_invoice(
        e.clone(),
        payer.clone(),
        invoice_id.clone(),
        99,
        5000,
        0,
    );

    let rec = SettlementContract::get_invoice(e, invoice_id).unwrap();
    assert_eq!(rec.principal_paid, 5000);
    assert_eq!(rec.status, SettlementStatus::Approved as u32);
}

// ---- role-based access control ---------------------------------------------

#[test]
#[should_panic(expected = "")]
fn non_admin_cannot_set_invoice_data() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let outsider = Address::generate(&e);
    init(&e, &admin);

    let invoice_id = Symbol::new(&e, "INV-OUTSIDER");
    SettlementContract::set_invoice_data(
        e,
        outsider.clone(),
        invoice_id,
        outsider.clone(),
        outsider,
        1000,
        5000000000,
        0,
    );
}

#[test]
#[should_panic(expected = "")]
fn pauser_can_pause_and_blocks_settle() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let payer = Address::generate(&e);
    init(&e, &admin);

    let pauser = Address::generate(&e);
    SettlementContract::grant_role(e.clone(), admin, access_control::Role::Pauser, pauser.clone());
    SettlementContract::pause(e.clone(), pauser);
    assert!(SettlementContract::is_paused(e.clone()));

    let invoice_id = Symbol::new(&e, "INV-PAUSED");
    SettlementContract::settle_invoice(e, payer, invoice_id, 1, 5000, 0);
}

#[test]
fn unpause_restores_settle_invoice() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let payer = Address::generate(&e);
    init(&e, &admin);

    let pauser = Address::generate(&e);
    SettlementContract::grant_role(e.clone(), admin.clone(), access_control::Role::Pauser, pauser.clone());
    SettlementContract::pause(e.clone(), pauser.clone());
    SettlementContract::unpause(e.clone(), pauser);
    assert!(!SettlementContract::is_paused(e.clone()));

    let invoice_id = Symbol::new(&e, "INV-UNPAUSED");
    SettlementContract::set_invoice_data(
        e.clone(),
        admin,
        invoice_id.clone(),
        payer.clone(),
        payer.clone(),
        5000,
        5000000000,
        0,
    );
    let deadline = 5000000000u64 + 2592000;
    let nm_key = StorageKey::nonce_meta(&invoice_id);
    let nm = NonceMeta::new(invoice_id.clone(), deadline);
    e.storage().persistent().set(&nm_key, &nm);

    SettlementContract::settle_invoice(e, payer, invoice_id, 1, 5000, 0);
}

#[test]
fn admin_transfer_full_flow() {
    let e = Env::default();
    e.mock_all_auths();

    let s1 = Address::generate(&e);
    let s2 = Address::generate(&e);
    let signers = signers_of(&e, &[s1.clone(), s2.clone()]);
    SettlementContract::init(e.clone(), signers, 2u32, MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);

    let new_signer = Address::generate(&e);
    let new_signers = signers_of(&e, &[new_signer.clone()]);
    SettlementContract::propose_admin_transfer(e.clone(), s1.clone(), new_signers, 1u32);
    SettlementContract::confirm_admin_transfer(e.clone(), s2.clone());

    use soroban_sdk::testutils::Ledger;
    e.ledger().with_mut(|li| {
        li.sequence_number += MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS;
    });
    SettlementContract::execute_admin_transfer(e.clone(), s1.clone());

    assert!(!SettlementContract::is_signer(e.clone(), s1));
    assert!(SettlementContract::is_signer(e, new_signer));
}
