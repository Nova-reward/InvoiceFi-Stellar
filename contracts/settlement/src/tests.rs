use super::{SettlementContract, SettlementContractClient, SettlementStatus, StorageKey};
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

fn setup_test() -> (Env, Address, SettlementContractClient<'static>) {
    let e = Env::default();
    e.mock_all_auths();
    let contract_id = e.register(SettlementContract, ());
    let client = SettlementContractClient::new(&e, &contract_id);
    (e, contract_id, client)
}

#[test]
fn test_init_stores_admin() {
    let (e, _, client) = setup_test();
    let admin = Address::generate(&e);
    let signers = signers_of(&e, &[admin.clone()]);
    client.init(&signers, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);
    assert!(client.is_signer(&admin));
}

#[test]
fn test_settle_invoice_requires_nonce() {
    let (e, contract_id, client) = setup_test();
    let admin = Address::generate(&e);
    let caller = Address::generate(&e);

    let signers = signers_of(&e, &[admin.clone()]);
    client.init(&signers, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);

    let invoice_id = Symbol::new(&e, "INV_NONCE");
    client.set_invoice_data(
        &admin,
        &invoice_id,
        &caller,
        &caller,
        &5000,
        &3000000000,
        &500,
    );

    let deadline = 3000000000u64 + 2592000;
    let nm_key = StorageKey::nonce_meta(&invoice_id);
    let nm = NonceMeta::new(&e, invoice_id.clone(), deadline);
    e.as_contract(&contract_id, || {
        e.storage().persistent().set(&nm_key, &nm);
    });

    // First call with nonce=1 should succeed
    client.settle_invoice(&caller, &invoice_id, &1, &1000, &0);

    // Use nonce=1 again - should be rejected as replay (panics)
    let res = client.try_settle_invoice(&caller, &invoice_id, &1, &1000, &0);
    assert!(res.is_err());
}

#[test]
fn test_settle_invoice_with_valid_nonce() {
    let (e, contract_id, client) = setup_test();
    let admin = Address::generate(&e);
    let payer = Address::generate(&e);

    let signers = signers_of(&e, &[admin.clone()]);
    client.init(&signers, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);

    let invoice_id = Symbol::new(&e, "INV_NONCE_OK");
    client.set_invoice_data(
        &admin,
        &invoice_id,
        &payer,
        &payer,
        &5000,
        &5000000000,
        &500,
    );

    let deadline = 5000000000u64 + 2592000;
    let nm_key = StorageKey::nonce_meta(&invoice_id);
    let nm = NonceMeta::new(&e, invoice_id.clone(), deadline);
    e.as_contract(&contract_id, || {
        e.storage().persistent().set(&nm_key, &nm);
    });

    // First call - should succeed
    client.settle_invoice(&payer, &invoice_id, &99, &5000, &0);

    let used = client.get_used_nonces(&invoice_id);
    assert!(used.contains(&99));

    let rec = client.get_invoice(&invoice_id).unwrap();
    assert_eq!(rec.principal_paid, 5000);
}

#[test]
fn test_settle_without_nonce_meta_creates_it() {
    let (e, contract_id, client) = setup_test();
    let admin = Address::generate(&e);
    let borrower = Address::generate(&e);

    let signers = signers_of(&e, &[admin.clone()]);
    client.init(&signers, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);

    let invoice_id = Symbol::new(&e, "INV_AUTO_NONCE");
    client.set_invoice_data(
        &admin,
        &invoice_id,
        &borrower,
        &borrower,
        &3000,
        &5000000000,
        &0, // zero fee rate
    );

    assert!(client.get_used_nonces(&invoice_id).is_empty());

    let deadline = 3000000000u64 + 2592000;
    let nm_key = StorageKey::nonce_meta(&invoice_id);
    let nm = NonceMeta::new(&e, invoice_id.clone(), deadline);

    e.as_contract(&contract_id, || {
        e.storage().persistent().set(&nm_key, &nm);
    });

    // Borrower authenticates as caller and settles invoice
    client.settle_invoice(&borrower, &invoice_id, &1, &3000, &0);
}

#[test]
fn test_nonce_replay_rejected() {
    let (e, contract_id, client) = setup_test();
    let admin = Address::generate(&e);
    let payer = Address::generate(&e);

    let signers = signers_of(&e, &[admin.clone()]);
    client.init(&signers, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);

    let invoice_id = Symbol::new(&e, "INV_NONCE_REPLAY");
    client.set_invoice_data(
        &admin,
        &invoice_id,
        &payer,
        &payer,
        &5000,
        &3900000000, // far future - nonce not expired
        &500,
    );

    let deadline = 3900000000u64 + 2592000;
    let nm_key = StorageKey::nonce_meta(&invoice_id);
    let nm = NonceMeta::new(&e, invoice_id.clone(), deadline);
    e.as_contract(&contract_id, || {
        e.storage().persistent().set(&nm_key, &nm);
    });

    // Use nonce 42 the first time - should succeed
    client.settle_invoice(&payer, &invoice_id, &42, &5000, &0);

    // Use nonce 42 again - should be rejected as replay
    let res = client.try_settle_invoice(&payer, &invoice_id, &42, &5000, &0);
    assert!(res.is_err());
}

#[test]
fn test_settlement_nonce_expiry() {
    let (e, contract_id, client) = setup_test();
    let admin = Address::generate(&e);
    let payer = Address::generate(&e);

    let signers = signers_of(&e, &[admin.clone()]);
    client.init(&signers, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);

    // due_date is far in the past - nonce already expired
    let due_date = 1000000000u64; // long past
    let invoice_id = Symbol::new(&e, "INV_NONCE_EXPIRED");
    client.set_invoice_data(
        &admin,
        &invoice_id,
        &payer,
        &payer,
        &5000,
        &due_date,
        &500,
    );

    let deadline = due_date + 2592000;
    let nm_key = StorageKey::nonce_meta(&invoice_id);
    let nm = NonceMeta::new(&e, invoice_id.clone(), deadline);
    e.as_contract(&contract_id, || {
        e.storage().persistent().set(&nm_key, &nm);
    });

    let used = client.get_used_nonces(&invoice_id);
    assert!(used.is_empty());
}

#[test]
fn test_get_used_nonces_returns_list() {
    let (e, _, client) = setup_test();
    let admin = Address::generate(&e);

    let signers = signers_of(&e, &[admin.clone()]);
    client.init(&signers, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);

    let invoice_id = Symbol::new(&e, "INV_NONCES");
    client.set_invoice_data(
        &admin,
        &invoice_id,
        &admin,
        &admin,
        &5000,
        &5000000000,
        &500,
    );

    let used = client.get_used_nonces(&invoice_id);
    assert_eq!(used.len(), 0);
}

#[test]
fn test_settle_updates_principal() {
    let (e, contract_id, client) = setup_test();
    let admin = Address::generate(&e);
    let payer = Address::generate(&e);

    let signers = signers_of(&e, &[admin.clone()]);
    client.init(&signers, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);

    let invoice_id = Symbol::new(&e, "INV_SETTLE");
    client.set_invoice_data(
        &admin,
        &invoice_id,
        &payer,
        &payer,
        &10000,
        &5000000000,
        &500,
    );

    let deadline = 5000000000u64 + 2592000;
    let nm_key = StorageKey::nonce_meta(&invoice_id);
    let nm = NonceMeta::new(&e, invoice_id.clone(), deadline);
    e.as_contract(&contract_id, || {
        e.storage().persistent().set(&nm_key, &nm);
    });

    client.settle_invoice(&payer, &invoice_id, &99, &5000, &0);

    let rec = client.get_invoice(&invoice_id).unwrap();
    assert_eq!(rec.principal_paid, 5000);
    assert_eq!(rec.status, SettlementStatus::ApprovedForSettlement as u32);
}

#[test]
fn non_admin_cannot_set_invoice_data() {
    let (e, _, client) = setup_test();
    let admin = Address::generate(&e);
    let outsider = Address::generate(&e);

    let signers = signers_of(&e, &[admin.clone()]);
    client.init(&signers, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);

    let invoice_id = Symbol::new(&e, "INV_OUTSIDER");
    let res = client.try_set_invoice_data(
        &outsider,
        &invoice_id,
        &outsider,
        &outsider,
        &1000,
        &5000000000,
        &0,
    );
    assert!(res.is_err());
}

#[test]
fn pauser_can_pause_and_blocks_settle() {
    let (e, _, client) = setup_test();
    let admin = Address::generate(&e);
    let payer = Address::generate(&e);

    let signers = signers_of(&e, &[admin.clone()]);
    client.init(&signers, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);

    let pauser = Address::generate(&e);
    client.grant_role(&admin, &access_control::Role::Pauser, &pauser);
    client.pause(&pauser);
    assert!(client.is_paused());

    let invoice_id = Symbol::new(&e, "INV_PAUSED");
    let res = client.try_settle_invoice(&payer, &invoice_id, &1, &5000, &0);
    assert!(res.is_err());
}

#[test]
fn unpause_restores_settle_invoice() {
    let (e, contract_id, client) = setup_test();
    let admin = Address::generate(&e);
    let payer = Address::generate(&e);

    let signers = signers_of(&e, &[admin.clone()]);
    client.init(&signers, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);

    let pauser = Address::generate(&e);
    client.grant_role(&admin, &access_control::Role::Pauser, &pauser);
    client.pause(&pauser);
    client.unpause(&pauser);
    assert!(!client.is_paused());

    let invoice_id = Symbol::new(&e, "INV_UNPAUSED");
    client.set_invoice_data(
        &admin,
        &invoice_id,
        &payer,
        &payer,
        &5000,
        &5000000000,
        &0,
    );
    let deadline = 5000000000u64 + 2592000;
    let nm_key = StorageKey::nonce_meta(&invoice_id);
    let nm = NonceMeta::new(&e, invoice_id.clone(), deadline);
    e.as_contract(&contract_id, || {
        e.storage().persistent().set(&nm_key, &nm);
    });

    client.settle_invoice(&payer, &invoice_id, &1, &5000, &0);
}

#[test]
fn admin_transfer_full_flow() {
    let (e, _, client) = setup_test();
    let s1 = Address::generate(&e);
    let s2 = Address::generate(&e);
    let signers = signers_of(&e, &[s1.clone(), s2.clone()]);
    client.init(&signers, &2u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);

    let new_signer = Address::generate(&e);
    let new_signers = signers_of(&e, &[new_signer.clone()]);
    client.propose_admin_transfer(&s1, &new_signers, &1u32);
    client.confirm_admin_transfer(&s2);

    use soroban_sdk::testutils::Ledger;
    e.ledger().with_mut(|li| {
        li.sequence_number += MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS;
    });
    client.execute_admin_transfer(&s1);

    assert!(!client.is_signer(&s1));
    assert!(client.is_signer(&new_signer));
}
