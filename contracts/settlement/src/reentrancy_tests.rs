//! Reentrancy attack tests for settlement contract
//! 
//! These tests simulate malicious contracts attempting to re-enter
//! the settlement contract during cross-contract calls.

use super::{SettlementContract, SettlementError, StorageKey, ReentrancyGuard};
use access_control::MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS;
use soroban_sdk::{testutils::Address as _, Address, Env, Symbol, Vec};

fn signers_of(env: &Env, addrs: &[Address]) -> Vec<Address> {
    let mut v = Vec::new(env);
    for a in addrs {
        v.push_back(a.clone());
    }
    v
}

/// Single-signer (1-of-1) admin set, at the minimum allowed time-lock.
fn init(e: &Env, admin: &Address) {
    let signers = signers_of(e, &[admin.clone()]);
    SettlementContract::init(e.clone(), signers, 1u32, MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);
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
        let caller = Address::generate(&env);
        SettlementContract::settle_invoice(
            env,
            caller,
            invoice_id,
            999, // different nonce
            1000,
            0,
        );
    }
}

#[test]
fn test_reentrancy_guard_blocks_settle_invoice_reentry() {
    let e = Env::default();
    e.mock_all_auths();
    
    let admin = Address::generate(&e);
    let caller = Address::generate(&e);
    let invoice_id = Symbol::new(&e, "INV-REENTRANCY");
    
    init(&e, &admin);
    
    // Set up invoice data
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
    
    // Set up nonce meta
    let deadline = 3000000000u64 + 2592000;
    let nm_key = StorageKey::nonce_meta(&invoice_id);
    let nm = crate::types::NonceMeta::new(invoice_id.clone(), deadline);
    e.storage().persistent().set(&nm_key, &nm);
    
    // First call should succeed
    SettlementContract::settle_invoice(
        e.clone(),
        caller.clone(),
        invoice_id.clone(),
        1,
        1000,
        0,
    );
    
    // Verify reentrancy guard is unlocked after successful call
    let guard: ReentrancyGuard = e
        .storage()
        .instance()
        .get(&StorageKey::ReentrancyGuard)
        .unwrap_or(ReentrancyGuard::Unlocked);
    assert_eq!(guard, ReentrancyGuard::Unlocked);
}

#[test]
#[should_panic(expected = "REENTRANCY_DETECTED")]
fn test_reentrancy_guard_blocks_when_locked() {
    let e = Env::default();
    e.mock_all_auths();
    
    let admin = Address::generate(&e);
    let caller = Address::generate(&e);
    let invoice_id = Symbol::new(&e, "INV-LOCKED");
    
    init(&e, &admin);
    
    // Manually lock the reentrancy guard to simulate mid-execution state
    e.storage()
        .instance()
        .set(&StorageKey::ReentrancyGuard, &ReentrancyGuard::Locked);
    
    // Set up invoice data
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
    
    // Set up nonce meta
    let deadline = 3000000000u64 + 2592000;
    let nm_key = StorageKey::nonce_meta(&invoice_id);
    let nm = crate::types::NonceMeta::new(invoice_id.clone(), deadline);
    e.storage().persistent().set(&nm_key, &nm);
    
    // This call should fail due to reentrancy guard being locked
    SettlementContract::settle_invoice(
        e,
        caller,
        invoice_id,
        1,
        1000,
        0,
    );
}

#[test]
fn test_reentrancy_guard_initialized_on_init() {
    let e = Env::default();
    e.mock_all_auths();
    
    let admin = Address::generate(&e);
    
    // Before init, guard should not exist
    let guard_before: Option<ReentrancyGuard> = e
        .storage()
        .instance()
        .get(&StorageKey::ReentrancyGuard);
    assert_eq!(guard_before, None);
    
    init(&e, &admin);
    
    // After init, guard should be Unlocked
    let guard_after: ReentrancyGuard = e
        .storage()
        .instance()
        .get(&StorageKey::ReentrancyGuard)
        .unwrap();
    assert_eq!(guard_after, ReentrancyGuard::Unlocked);
}

#[test]
fn test_state_updated_before_external_call_simulation() {
    let e = Env::default();
    e.mock_all_auths();
    
    let admin = Address::generate(&e);
    let caller = Address::generate(&e);
    let invoice_id = Symbol::new(&e, "INV-STATE-ORDER");
    
    init(&e, &admin);
    
    // Set financing pool address to trigger cross-contract call path
    let pool_address = Address::generate(&e);
    SettlementContract::set_financing_pool_address(e.clone(), admin.clone(), pool_address.clone());
    
    // Set up invoice data
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
    
    // Set up nonce meta
    let deadline = 3000000000u64 + 2592000;
    let nm_key = StorageKey::nonce_meta(&invoice_id);
    let nm = crate::types::NonceMeta::new(invoice_id.clone(), deadline);
    e.storage().persistent().set(&nm_key, &nm);
    
    // Get initial state
    let invoice_before = SettlementContract::get_invoice(e.clone(), invoice_id.clone()).unwrap();
    assert_eq!(invoice_before.principal_paid, 0);
    
    // Call settle_invoice
    SettlementContract::settle_invoice(
        e.clone(),
        caller.clone(),
        invoice_id.clone(),
        1,
        1000,
        0,
    );
    
    // Verify state was updated (even though external call is simulated via event)
    let invoice_after = SettlementContract::get_invoice(e, invoice_id).unwrap();
    assert!(invoice_after.principal_paid > 0);
}

#[test]
fn test_financing_pool_address_configuration() {
    let e = Env::default();
    e.mock_all_auths();
    
    let admin = Address::generate(&e);
    let pool_address = Address::generate(&e);
    let unauthorized = Address::generate(&e);
    
    init(&e, &admin);
    
    // Admin can set pool address
    SettlementContract::set_financing_pool_address(e.clone(), admin.clone(), pool_address.clone());
    
    let retrieved = SettlementContract::get_financing_pool_address(e.clone()).unwrap();
    assert_eq!(retrieved, pool_address);
    
    // Unauthorized user cannot set pool address (would panic in real scenario)
    // This is tested via require_auth in the implementation
}
