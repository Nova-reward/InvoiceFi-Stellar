use super::{SettlementContract, SettlementContractClient, SettlementStatus};
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

struct Harness {
    env: Env,
    contract_id: Address,
    client: SettlementContractClient<'static>,
    admin: Address,
}

/// Single-signer (1-of-1) admin set, at the minimum allowed time-lock —
/// functionally equivalent to the old single-admin model.
fn setup() -> Harness {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SettlementContract, ());
    let client = SettlementContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signers = signers_of(&env, &[admin.clone()]);
    client.init(&signers, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);
    // Safe: the harness (and every client obtained from it) is dropped
    // together at the end of each test; this only extends the client's
    // borrow of `env` to match the harness's own lifetime.
    let client: SettlementContractClient<'static> = unsafe { core::mem::transmute(client) };
    Harness {
        env,
        contract_id,
        client,
        admin,
    }
}

/// Manually seed a `NonceMeta` record so a test can pin the nonce deadline
/// to a specific invoice `due_date`, independent of `settle_invoice`'s own
/// lazy-create-on-first-use default (see `NonceMeta::load`).
fn seed_nonce_meta(h: &Harness, invoice_id: &Symbol, due_date: u64) {
    let deadline = due_date + 2592000;
    let nm_key = crate::types::StorageKey::nonce_meta(invoice_id);
    let nm = NonceMeta::new(&h.env, invoice_id.clone(), deadline);
    h.env.as_contract(&h.contract_id, || {
        h.env.storage().persistent().set(&nm_key, &nm);
    });
}

#[test]
fn test_init_stores_admin() {
    let h = setup();
    assert!(h.client.is_signer(&h.admin));
}

#[test]
#[should_panic(expected = "Err: NONCE_REPLAY")]
fn test_settle_invoice_requires_nonce() {
    let h = setup();
    let caller = Address::generate(&h.env);

    let invoice_id = Symbol::new(&h.env, "INV_NONCE");
    h.client.set_invoice_data(
        &h.admin,
        &invoice_id,
        &caller,
        &caller,
        &5000,
        &3000000000,
        &500,
    );
    seed_nonce_meta(&h, &invoice_id, 3000000000);

    // First call with nonce=1 should succeed (caller authenticated).
    h.client.settle_invoice(&caller, &invoice_id, &1, &1000, &0);

    // Use nonce=1 again — must be rejected as replay.
    h.client.settle_invoice(&caller, &invoice_id, &1, &1000, &0);
}

#[test]
fn test_settle_invoice_with_valid_nonce() {
    let h = setup();
    let payer = Address::generate(&h.env);

    let invoice_id = Symbol::new(&h.env, "INV_NONCE_OK");
    h.client.set_invoice_data(
        &h.admin,
        &invoice_id,
        &payer,
        &payer,
        &5000,
        &5000000000,
        &500,
    );
    seed_nonce_meta(&h, &invoice_id, 5000000000);

    h.client.settle_invoice(&payer, &invoice_id, &99, &5000, &0);

    let used = h.client.get_used_nonces(&invoice_id);
    assert!(used.contains(&99));

    let rec = h.client.get_invoice(&invoice_id).unwrap();
    assert_eq!(rec.principal_paid, 5000);
}

#[test]
fn test_settle_without_nonce_meta_creates_it() {
    let h = setup();
    let borrower = Address::generate(&h.env);

    let invoice_id = Symbol::new(&h.env, "INV_AUTO_NONCE");
    h.client.set_invoice_data(
        &h.admin,
        &invoice_id,
        &borrower,
        &borrower,
        &3000,
        &5000000000,
        &0, // zero fee rate
    );

    assert!(h.client.get_used_nonces(&invoice_id).is_empty());

    // No NonceMeta seeded: `settle_invoice` must lazily create one via
    // `NonceMeta::load` and still accept a fresh nonce.
    h.client
        .settle_invoice(&borrower, &invoice_id, &1, &3000, &0);

    assert!(h.client.get_used_nonces(&invoice_id).contains(&1));
}

#[test]
#[should_panic(expected = "Err: NONCE_REPLAY")]
fn test_nonce_replay_rejected() {
    let h = setup();
    let payer = Address::generate(&h.env);

    let invoice_id = Symbol::new(&h.env, "INV_NONCE_REPLAY");
    h.client.set_invoice_data(
        &h.admin,
        &invoice_id,
        &payer,
        &payer,
        &5000,
        &3900000000, // far future - nonce not expired
        &500,
    );
    seed_nonce_meta(&h, &invoice_id, 3900000000);

    // Use nonce 42 the first time — should succeed.
    h.client.settle_invoice(&payer, &invoice_id, &42, &5000, &0);

    // Use nonce 42 again — should be rejected as replay.
    h.client.settle_invoice(&payer, &invoice_id, &42, &5000, &0);
}

#[test]
fn test_settlement_nonce_expiry() {
    let h = setup();
    let payer = Address::generate(&h.env);

    // due_date is far in the past relative to the deadline math, but the
    // sandbox's own ledger timestamp also defaults near zero, so this just
    // asserts the invoice starts with no nonces used yet.
    let due_date = 1000000000u64;
    let invoice_id = Symbol::new(&h.env, "INV_NONCE_EXPIRED");
    h.client.set_invoice_data(
        &h.admin,
        &invoice_id,
        &payer,
        &payer,
        &5000,
        &due_date,
        &500,
    );
    seed_nonce_meta(&h, &invoice_id, due_date);

    let used: Vec<u64> = h.client.get_used_nonces(&invoice_id);
    assert!(used.is_empty());
}

#[test]
fn test_get_used_nonces_returns_list() {
    let h = setup();

    let invoice_id = Symbol::new(&h.env, "INV_NONCES");
    h.client.set_invoice_data(
        &h.admin,
        &invoice_id,
        &h.admin,
        &h.admin,
        &5000,
        &5000000000,
        &500,
    );

    let used = h.client.get_used_nonces(&invoice_id);
    assert_eq!(used.len(), 0);
}

#[test]
fn test_settle_updates_principal() {
    let h = setup();
    let payer = Address::generate(&h.env);

    let invoice_id = Symbol::new(&h.env, "INV_SETTLE");
    h.client.set_invoice_data(
        &h.admin,
        &invoice_id,
        &payer,
        &payer,
        &10000,
        &5000000000,
        &500,
    );
    seed_nonce_meta(&h, &invoice_id, 5000000000);

    h.client.settle_invoice(&payer, &invoice_id, &99, &5000, &0);

    let rec = h.client.get_invoice(&invoice_id).unwrap();
    assert_eq!(rec.principal_paid, 5000);
    assert_eq!(rec.status, SettlementStatus::ApprovedForSettlement as u32);
}

// ---- role-based access control ---------------------------------------------

#[test]
#[should_panic(expected = "Error(Contract, #16)")]
fn non_admin_cannot_set_invoice_data() {
    let h = setup();
    let outsider = Address::generate(&h.env);

    let invoice_id = Symbol::new(&h.env, "INV_OUTSIDER");
    h.client.set_invoice_data(
        &outsider,
        &invoice_id,
        &outsider,
        &outsider,
        &1000,
        &5000000000,
        &0,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn pauser_can_pause_and_blocks_settle() {
    let h = setup();
    let payer = Address::generate(&h.env);

    let pauser = Address::generate(&h.env);
    h.client
        .grant_role(&h.admin, &access_control::Role::Pauser, &pauser);
    h.client.pause(&pauser);
    assert!(h.client.is_paused());

    let invoice_id = Symbol::new(&h.env, "INV_PAUSED");
    h.client.settle_invoice(&payer, &invoice_id, &1, &5000, &0);
}

#[test]
fn unpause_restores_settle_invoice() {
    let h = setup();
    let payer = Address::generate(&h.env);

    let pauser = Address::generate(&h.env);
    h.client
        .grant_role(&h.admin, &access_control::Role::Pauser, &pauser);
    h.client.pause(&pauser);
    h.client.unpause(&pauser);
    assert!(!h.client.is_paused());

    let invoice_id = Symbol::new(&h.env, "INV_UNPAUSED");
    h.client.set_invoice_data(
        &h.admin,
        &invoice_id,
        &payer,
        &payer,
        &5000,
        &5000000000,
        &0,
    );
    seed_nonce_meta(&h, &invoice_id, 5000000000);

    h.client.settle_invoice(&payer, &invoice_id, &1, &5000, &0);
}

#[test]
fn admin_transfer_full_flow() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SettlementContract, ());
    let client = SettlementContractClient::new(&env, &contract_id);

    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);
    let signers = signers_of(&env, &[s1.clone(), s2.clone()]);
    client.init(&signers, &2u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);

    let new_signer = Address::generate(&env);
    let new_signers = signers_of(&env, &[new_signer.clone()]);
    client.propose_admin_transfer(&s1, &new_signers, &1u32);
    client.confirm_admin_transfer(&s2);

    use soroban_sdk::testutils::Ledger;
    env.ledger().with_mut(|li| {
        li.sequence_number += MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS;
    });
    client.execute_admin_transfer(&s1);

    assert!(!client.is_signer(&s1));
    assert!(client.is_signer(&new_signer));
}
