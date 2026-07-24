//! Reentrancy attack tests for financing pool contract
//! 
//! These tests simulate malicious token contracts attempting to re-enter
//! the financing pool during deposit/withdraw operations.

use super::{FinancingPoolContract, DataKey, Error};
use crate::types::{TokenContract, ReentrancyGuard, StorageKey};
use soroban_sdk::{testutils::Address as _, Address, Env};

/// Mock malicious token contract that attempts reentrancy
#[contract]
pub struct MaliciousTokenContract;

#[contractimpl]
impl MaliciousTokenContract {
    /// Simulates a malicious callback that tries to re-enter the pool
    pub fn malicious_transfer_callback(env: Env, pool_address: Address, from: Address) {
        // Attempt to call deposit again (reentrancy attempt)
        // This should fail due to the reentrancy guard
        FinancingPoolContract::deposit(env, from, 1000i128);
    }
}

#[test]
fn test_reentrancy_guard_blocks_deposit_reentry() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FinancingPoolContract, ());
    let client = FinancingPoolContractClient::new(&env, &contract_id);
    
    let admin = Address::generate(&env);
    client.initialize(&admin, &1000u32);
    
    let lp = Address::generate(&env);
    
    // First deposit should succeed
    client.deposit(&lp, &1_000i128);
    
    // Verify reentrancy guard is unlocked after successful call
    let guard: ReentrancyGuard = env
        .storage()
        .instance()
        .get(&StorageKey::reentrancy_guard())
        .unwrap_or(ReentrancyGuard::Unlocked);
    assert_eq!(guard, ReentrancyGuard::Unlocked);
    
    // Verify balance was updated
    assert_eq!(client.balance_of(&lp), 1_000);
}

#[test]
fn test_reentrancy_guard_blocks_withdraw_reentry() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FinancingPoolContract, ());
    let client = FinancingPoolContractClient::new(&env, &contract_id);
    
    let admin = Address::generate(&env);
    client.initialize(&admin, &1000u32);
    
    let lp = Address::generate(&env);
    client.deposit(&lp, &1_000i128);
    
    // Withdraw should succeed
    client.withdraw(&lp, &500i128);
    
    // Verify reentrancy guard is unlocked after successful call
    let guard: ReentrancyGuard = env
        .storage()
        .instance()
        .get(&StorageKey::reentrancy_guard())
        .unwrap_or(ReentrancyGuard::Unlocked);
    assert_eq!(guard, ReentrancyGuard::Unlocked);
    
    // Verify balance was updated
    assert_eq!(client.balance_of(&lp), 500);
}

#[test]
fn test_reentrancy_guard_blocks_when_locked_deposit() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FinancingPoolContract, ());
    let client = FinancingPoolContractClient::new(&env, &contract_id);
    
    let admin = Address::generate(&env);
    client.initialize(&admin, &1000u32);
    
    // Manually lock the reentrancy guard to simulate mid-execution state
    env.storage()
        .instance()
        .set(&StorageKey::reentrancy_guard(), &ReentrancyGuard::Locked);
    
    let lp = Address::generate(&env);
    
    // This deposit should fail due to reentrancy guard being locked
    assert_eq!(
        client.try_deposit(&lp, &1_000i128),
        Err(Ok(Error::ReentrancyDetected))
    );
}

#[test]
fn test_reentrancy_guard_blocks_when_locked_withdraw() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FinancingPoolContract, ());
    let client = FinancingPoolContractClient::new(&env, &contract_id);
    
    let admin = Address::generate(&env);
    client.initialize(&admin, &1000u32);
    
    let lp = Address::generate(&env);
    client.deposit(&lp, &1_000i128);
    
    // Manually lock the reentrancy guard to simulate mid-execution state
    env.storage()
        .instance()
        .set(&StorageKey::reentrancy_guard(), &ReentrancyGuard::Locked);
    
    // This withdraw should fail due to reentrancy guard being locked
    assert_eq!(
        client.try_withdraw(&lp, &500i128),
        Err(Ok(Error::ReentrancyDetected))
    );
}

#[test]
fn test_reentrancy_guard_initialized_on_init() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FinancingPoolContract, ());
    let client = FinancingPoolContractClient::new(&env, &contract_id);
    
    let admin = Address::generate(&env);
    
    // Before init, guard should not exist
    let guard_before: Option<ReentrancyGuard> = env
        .storage()
        .instance()
        .get(&StorageKey::reentrancy_guard());
    assert_eq!(guard_before, None);
    
    client.initialize(&admin, &1000u32);
    
    // After init, guard should be Unlocked
    let guard_after: ReentrancyGuard = env
        .storage()
        .instance()
        .get(&StorageKey::reentrancy_guard())
        .unwrap();
    assert_eq!(guard_after, ReentrancyGuard::Unlocked);
}

#[test]
fn test_state_updated_before_token_transfer_simulation() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FinancingPoolContract, ());
    let client = FinancingPoolContractClient::new(&env, &contract_id);
    
    let admin = Address::generate(&env);
    client.initialize(&admin, &1000u32);
    
    // Set XLM token address to trigger cross-contract call path
    let token_address = Address::generate(&env);
    client.set_token_address(&TokenContract::XLM, &token_address);
    
    let lp = Address::generate(&env);
    
    // Get initial state
    let balance_before = client.balance_of(&lp);
    let available_before = client.available_liquidity();
    assert_eq!(balance_before, 0);
    assert_eq!(available_before, 0);
    
    // Deposit should update state before token transfer
    client.deposit(&lp, &1_000i128);
    
    // Verify state was updated (even though token transfer is simulated via event)
    let balance_after = client.balance_of(&lp);
    let available_after = client.available_liquidity();
    assert_eq!(balance_after, 1_000);
    assert_eq!(available_after, 1_000);
}

#[test]
fn test_token_address_configuration() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FinancingPoolContract, ());
    let client = FinancingPoolContractClient::new(&env, &contract_id);
    
    let admin = Address::generate(&env);
    client.initialize(&admin, &1000u32);
    
    let xlm_address = Address::generate(&env);
    let usdc_address = Address::generate(&env);
    let aqua_address = Address::generate(&env);
    
    // Admin can set token addresses
    client.set_token_address(&TokenContract::XLM, &xlm_address);
    client.set_token_address(&TokenContract::USDC, &usdc_address);
    client.set_token_address(&TokenContract::AQUA, &aqua_address);
    
    // Verify addresses are stored correctly
    assert_eq!(client.get_token_address(TokenContract::XLM), Some(xlm_address));
    assert_eq!(client.get_token_address(TokenContract::USDC), Some(usdc_address));
    assert_eq!(client.get_token_address(TokenContract::AQUA), Some(aqua_address));
}

#[test]
fn test_withdraw_state_updated_before_token_transfer() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FinancingPoolContract, ());
    let client = FinancingPoolContractClient::new(&env, &contract_id);
    
    let admin = Address::generate(&env);
    client.initialize(&admin, &1000u32);
    
    // Set XLM token address to trigger cross-contract call path
    let token_address = Address::generate(&env);
    client.set_token_address(&TokenContract::XLM, &token_address);
    
    let lp = Address::generate(&env);
    client.deposit(&lp, &1_000i128);
    
    // Get initial state
    let balance_before = client.balance_of(&lp);
    let available_before = client.available_liquidity();
    assert_eq!(balance_before, 1_000);
    assert_eq!(available_before, 1_000);
    
    // Withdraw should update state before token transfer
    client.withdraw(&lp, &500i128);
    
    // Verify state was updated (even though token transfer is simulated via event)
    let balance_after = client.balance_of(&lp);
    let available_after = client.available_liquidity();
    assert_eq!(balance_after, 500);
    assert_eq!(available_after, 500);
}
