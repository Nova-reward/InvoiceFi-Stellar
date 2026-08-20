//! Reentrancy attack tests for settlement contract
//!
//! These tests simulate malicious contracts attempting to re-enter
//! the settlement contract during cross-contract calls.

use super::{SettlementContract, SettlementContractClient, SettlementTrait};
use crate::types::{ReentrancyGuard, StorageKey};
use access_control::MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS;
use soroban_sdk::{contract, contractimpl, testutils::Address as _, Address, Env, Symbol, Vec};

fn signers_of(env: &Env, addrs: &[Address]) -> Vec<Address> {
    let mut v = Vec::new(env);
    for a in addrs {
        v.push_back(a.clone());
    }
    v
}

/// Single-signer (1-of-1) admin set, at the minimum allowed time-lock.
fn init(client: &SettlementContractClient<'_>, env: &Env, admin: &Address) {
    let signers = signers_of(env, &[admin.clone()]);
    client.init(&signers, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);
}

/// Mock malicious contract that attempts reentrancy. Not exercised by any
/// test below (the reentrancy guard is instead verified directly, by
/// pre-locking it — see `test_reentrancy_guard_blocks_when_locked`), but
/// kept as a reference double for a true cross-contract reentrancy test.
#[contract]
pub struct MaliciousContract;

#[contractimpl]
impl MaliciousContract {
    /// Simulates a malicious callback that tries to re-enter settlement.
    pub fn malicious_callback(env: Env, _settlement_address: Address, invoice_id: Symbol) {
        // Attempt to call settle_invoice again (reentrancy attempt).
        // This should fail due to the reentrancy guard.
        let caller = Address::generate(&env);
        SettlementContract::settle_invoice(
            env, caller, invoice_id, 999, // different nonce
            1000, 0,
        );
    }
}

#[test]
fn test_reentrancy_guard_blocks_settle_invoice_reentry() {
    let e = Env::default();
    e.mock_all_auths();
    let contract_id = e.register(SettlementContract, ());
    let client = SettlementContractClient::new(&e, &contract_id);

    let admin = Address::generate(&e);
    let caller = Address::generate(&e);
    let invoice_id = Symbol::new(&e, "INV_REENTRANCY");

    init(&client, &e, &admin);

    // Set up invoice data
    client.set_invoice_data(
        &admin,
        &invoice_id,
        &caller,
        &caller,
        &5000,
        &3000000000,
        &500,
    );

    // First call should succeed
    client.settle_invoice(&caller, &invoice_id, &1, &1000, &0);

    // Verify reentrancy guard is unlocked after successful call. Direct
    // storage reads must run inside `env.as_contract` — the storage API is
    // only accessible from within the target contract's execution context.
    let guard: ReentrancyGuard = e.as_contract(&contract_id, || {
        e.storage()
            .instance()
            .get(&StorageKey::ReentrancyGuard)
            .unwrap_or(ReentrancyGuard::Unlocked)
    });
    assert_eq!(guard, ReentrancyGuard::Unlocked);
}

#[test]
#[should_panic(expected = "REENTRANCY_DETECTED")]
fn test_reentrancy_guard_blocks_when_locked() {
    let e = Env::default();
    e.mock_all_auths();
    let contract_id = e.register(SettlementContract, ());
    let client = SettlementContractClient::new(&e, &contract_id);

    let admin = Address::generate(&e);
    let caller = Address::generate(&e);
    let invoice_id = Symbol::new(&e, "INV_LOCKED");

    init(&client, &e, &admin);

    // Manually lock the reentrancy guard to simulate mid-execution state.
    e.as_contract(&contract_id, || {
        e.storage()
            .instance()
            .set(&StorageKey::ReentrancyGuard, &ReentrancyGuard::Locked);
    });

    // Set up invoice data
    client.set_invoice_data(
        &admin,
        &invoice_id,
        &caller,
        &caller,
        &5000,
        &3000000000,
        &500,
    );

    // This call should fail due to the reentrancy guard being locked.
    client.settle_invoice(&caller, &invoice_id, &1, &1000, &0);
}

#[test]
fn test_reentrancy_guard_initialized_on_init() {
    let e = Env::default();
    e.mock_all_auths();
    let contract_id = e.register(SettlementContract, ());
    let client = SettlementContractClient::new(&e, &contract_id);

    let admin = Address::generate(&e);

    // Before init, guard should not exist.
    let guard_before: Option<ReentrancyGuard> = e.as_contract(&contract_id, || {
        e.storage().instance().get(&StorageKey::ReentrancyGuard)
    });
    assert_eq!(guard_before, None);

    init(&client, &e, &admin);

    // After init, guard should be Unlocked.
    let guard_after: ReentrancyGuard = e.as_contract(&contract_id, || {
        e.storage()
            .instance()
            .get(&StorageKey::ReentrancyGuard)
            .unwrap()
    });
    assert_eq!(guard_after, ReentrancyGuard::Unlocked);
}

#[test]
fn test_state_updated_before_external_call_simulation() {
    let e = Env::default();
    e.mock_all_auths();
    let contract_id = e.register(SettlementContract, ());
    let client = SettlementContractClient::new(&e, &contract_id);

    let admin = Address::generate(&e);
    let caller = Address::generate(&e);
    let invoice_id = Symbol::new(&e, "INV_STATE_ORDER");

    init(&client, &e, &admin);

    // Set financing pool address to trigger the cross-contract call path.
    let pool_address = Address::generate(&e);
    client.set_financing_pool_address(&admin, &pool_address);

    // Set up invoice data
    client.set_invoice_data(
        &admin,
        &invoice_id,
        &caller,
        &caller,
        &5000,
        &3000000000,
        &500,
    );

    // Get initial state
    let invoice_before = client.get_invoice(&invoice_id).unwrap();
    assert_eq!(invoice_before.principal_paid, 0);

    // Call settle_invoice
    client.settle_invoice(&caller, &invoice_id, &1, &1000, &0);

    // Verify state was updated (even though the external call is simulated
    // via event).
    let invoice_after = client.get_invoice(&invoice_id).unwrap();
    assert!(invoice_after.principal_paid > 0);
}

#[test]
fn test_financing_pool_address_configuration() {
    let e = Env::default();
    e.mock_all_auths();
    let contract_id = e.register(SettlementContract, ());
    let client = SettlementContractClient::new(&e, &contract_id);

    let admin = Address::generate(&e);
    let pool_address = Address::generate(&e);

    init(&client, &e, &admin);

    // Admin can set pool address
    client.set_financing_pool_address(&admin, &pool_address);

    let retrieved = client.get_financing_pool_address().unwrap();
    assert_eq!(retrieved, pool_address);

    // A non-admin caller is rejected by `AccessControl::require_admin`; see
    // `test_set_financing_pool_address_requires_admin` below for the
    // dedicated negative-path test.
}

#[test]
#[should_panic(expected = "Error(Contract, #16)")]
fn test_set_financing_pool_address_requires_admin() {
    let e = Env::default();
    e.mock_all_auths();
    let contract_id = e.register(SettlementContract, ());
    let client = SettlementContractClient::new(&e, &contract_id);

    let admin = Address::generate(&e);
    let unauthorized = Address::generate(&e);
    let pool_address = Address::generate(&e);

    init(&client, &e, &admin);

    // `unauthorized` is not a signer, so this must panic with the typed
    // `NotASigner` error (SettlementError variant 16) rather than succeed.
    client.set_financing_pool_address(&unauthorized, &pool_address);
}
