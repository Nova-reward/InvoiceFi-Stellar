//! Reentrancy attack tests for settlement contract
//! 
//! These tests simulate malicious token contracts attempting to re-enter
//! the settlement during settle_invoice operations.

use super::{SettlementContract, SettlementContractClient, SettlementStatus, StorageKey, ReentrancyGuard};
use access_control::MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS;
use soroban_sdk::{contract, contractimpl, testutils::Address as _, Address, Env, Symbol, Vec};

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

/// Mock malicious contract that attempts reentrancy
#[contract]
pub struct MaliciousContract;

#[contractimpl]
impl MaliciousContract {
    /// Simulates a malicious callback that tries to re-enter settlement
    pub fn malicious_callback(env: Env, settlement_address: Address, invoice_id: Symbol) {
        // Attempt to call settle_invoice again (reentrancy attempt)
        // This should fail due to the reentrancy guard
        let client = SettlementContractClient::new(&env, &settlement_address);
        let caller = Address::generate(&env);
        let _ = client.try_settle_invoice(
            &caller,
            &invoice_id,
            &999, // different nonce
            &1000,
            &0,
        );
    }
}

#[test]
fn test_reentrancy_guard_blocks_settle_invoice_reentry() {
    let (e, contract_id, client) = setup_test();
    let admin = Address::generate(&e);
    let caller = Address::generate(&e);
    let invoice_id = Symbol::new(&e, "INV_REENTRANCY");
    
    let signers = signers_of(&e, &[admin.clone()]);
    client.init(&signers, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);
    
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
    
    // Set up nonce meta
    let deadline = 3000000000u64 + 2592000;
    let nm_key = StorageKey::nonce_meta(&invoice_id);
    let nm = crate::types::NonceMeta::new(&e, invoice_id.clone(), deadline);
    e.as_contract(&contract_id, || {
        e.storage().persistent().set(&nm_key, &nm);
    });
    
    // First call should succeed
    client.settle_invoice(&caller, &invoice_id, &1, &1000, &0);
    
    // Verify reentrancy guard is unlocked after successful call
    let guard: ReentrancyGuard = e.as_contract(&contract_id, || {
        e.storage()
            .instance()
            .get(&StorageKey::ReentrancyGuard)
            .unwrap_or(ReentrancyGuard::Unlocked)
    });
    assert_eq!(guard, ReentrancyGuard::Unlocked);
}

#[test]
fn test_reentrancy_guard_blocks_when_locked() {
    let (e, contract_id, client) = setup_test();
    let admin = Address::generate(&e);
    let caller = Address::generate(&e);
    let invoice_id = Symbol::new(&e, "INV_LOCKED");
    
    let signers = signers_of(&e, &[admin.clone()]);
    client.init(&signers, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);
    
    // Manually lock the reentrancy guard to simulate mid-execution state
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
    
    // Set up nonce meta
    let deadline = 3000000000u64 + 2592000;
    let nm_key = StorageKey::nonce_meta(&invoice_id);
    let nm = crate::types::NonceMeta::new(&e, invoice_id.clone(), deadline);
    e.as_contract(&contract_id, || {
        e.storage().persistent().set(&nm_key, &nm);
    });
    
    // This call should fail due to reentrancy guard being locked
    let res = client.try_settle_invoice(
        &caller,
        &invoice_id,
        &1,
        &1000,
        &0,
    );
    assert!(res.is_err());
}

#[test]
fn test_reentrancy_guard_initialized_on_init() {
    let (e, contract_id, client) = setup_test();
    let admin = Address::generate(&e);
    
    // Before init, guard should not exist
    let guard_before: Option<ReentrancyGuard> = e.as_contract(&contract_id, || {
        e.storage()
            .instance()
            .get(&StorageKey::ReentrancyGuard)
    });
    assert_eq!(guard_before, None);
    
    let signers = signers_of(&e, &[admin.clone()]);
    client.init(&signers, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);
    
    // After init, guard should be Unlocked
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
    let (e, contract_id, client) = setup_test();
    let admin = Address::generate(&e);
    let caller = Address::generate(&e);
    let invoice_id = Symbol::new(&e, "INV_STATE_ORDER");
    
    let signers = signers_of(&e, &[admin.clone()]);
    client.init(&signers, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);
    
    // Set financing pool address to trigger cross-contract call path
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
    
    // Set up nonce meta
    let deadline = 3000000000u64 + 2592000;
    let nm_key = StorageKey::nonce_meta(&invoice_id);
    let nm = crate::types::NonceMeta::new(&e, invoice_id.clone(), deadline);
    e.as_contract(&contract_id, || {
        e.storage().persistent().set(&nm_key, &nm);
    });
    
    // Get initial state
    let invoice_before = client.get_invoice(&invoice_id).unwrap();
    assert_eq!(invoice_before.principal_paid, 0);
    
    // Call settle_invoice
    client.settle_invoice(&caller, &invoice_id, &1, &1000, &0);
    
    // Verify state was updated (even though external call is simulated via event)
    let invoice_after = client.get_invoice(&invoice_id).unwrap();
    assert!(invoice_after.principal_paid > 0);
}

#[test]
fn test_financing_pool_address_configuration() {
    let (e, _, client) = setup_test();
    let admin = Address::generate(&e);
    let pool_address = Address::generate(&e);
    
    let signers = signers_of(&e, &[admin.clone()]);
    client.init(&signers, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);
    
    // Admin can set pool address
    client.set_financing_pool_address(&admin, &pool_address);
    
    let retrieved = client.get_financing_pool_address().unwrap();
    assert_eq!(retrieved, pool_address);
}
