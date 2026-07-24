#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env,
};

const DISCOUNT_BPS: u32 = 1_000; // 10%

struct Harness {
    env: Env,
    client: FinancingPoolContractClient<'static>,
    admin: Address,
}

fn signers_of(env: &Env, addrs: &[Address]) -> Vec<Address> {
    let mut v = Vec::new(env);
    for a in addrs {
        v.push_back(a.clone());
    }
    v
}

fn setup_with(discount_bps: u32) -> Harness {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FinancingPoolContract, ());
    let client = FinancingPoolContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signers = signers_of(&env, &[admin.clone()]);
    client.initialize(
        &signers,
        &1u32,
        &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS,
        &discount_bps,
    );
    Harness { env, client, admin }
}

fn setup() -> Harness {
    setup_with(DISCOUNT_BPS)
}

// ---- initialization --------------------------------------------------------

#[test]
fn initialize_sets_state() {
    let h = setup();
    assert!(h.client.is_signer(&h.admin));
    assert_eq!(h.client.discount_bps(), DISCOUNT_BPS);
    assert_eq!(h.client.available_liquidity(), 0);
}

#[test]
fn initialize_twice_fails() {
    let h = setup();
    let other = signers_of(&h.env, &[Address::generate(&h.env)]);
    assert_eq!(
        h.client
            .try_initialize(&other, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS, &500u32),
        Err(Ok(Error::AlreadyInitialized))
    );
}

#[test]
fn initialize_rejects_discount_at_or_above_100pct() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FinancingPoolContract, ());
    let client = FinancingPoolContractClient::new(&env, &contract_id);
    let signers = signers_of(&env, &[Address::generate(&env)]);
    assert_eq!(
        client.try_initialize(
            &signers,
            &1u32,
            &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS,
            &10_000u32
        ),
        Err(Ok(Error::InvalidDiscount))
    );
}

#[test]
fn deposit_before_initialize_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FinancingPoolContract, ());
    let client = FinancingPoolContractClient::new(&env, &contract_id);
    let lp = Address::generate(&env);
    assert_eq!(
        client.try_deposit(&lp, &100i128),
        Err(Ok(Error::NotInitialized))
    );
}

// ---- deposit ---------------------------------------------------------------

#[test]
fn deposit_credits_balance_and_liquidity() {
    let h = setup();
    let lp = Address::generate(&h.env);
    h.client.deposit(&lp, &1_000i128);
    h.client.deposit(&lp, &500i128);
    assert_eq!(h.client.balance_of(&lp), 1_500);
    assert_eq!(h.client.available_liquidity(), 1_500);
}

#[test]
fn deposit_requires_auth() {
    let h = setup();
    let lp = Address::generate(&h.env);
    h.client.deposit(&lp, &1_000i128);
    assert_eq!(h.env.auths().first().unwrap().0, lp);
}

// ---- edge case: zero / negative deposit ------------------------------------

#[test]
fn deposit_zero_fails() {
    let h = setup();
    let lp = Address::generate(&h.env);
    assert_eq!(
        h.client.try_deposit(&lp, &0i128),
        Err(Ok(Error::InvalidAmount))
    );
}

#[test]
fn deposit_negative_fails() {
    let h = setup();
    let lp = Address::generate(&h.env);
    assert_eq!(
        h.client.try_deposit(&lp, &-1i128),
        Err(Ok(Error::InvalidAmount))
    );
}

// ---- discount calculation --------------------------------------------------

#[test]
fn quote_applies_discount() {
    let h = setup(); // 10%
    assert_eq!(h.client.quote(&1_000i128), 900);
    assert_eq!(h.client.discount_amount(&1_000i128), 100);
}

#[test]
fn quote_zero_discount_returns_face_value() {
    let h = setup_with(0);
    assert_eq!(h.client.quote(&1_000i128), 1_000);
    assert_eq!(h.client.discount_amount(&1_000i128), 0);
}

#[test]
fn quote_rounds_in_favor_of_pool() {
    // 12.34% discount on 1000 => advance = 1000 * 8766 / 10000 = 876.6 -> 876
    let h = setup_with(1_234);
    assert_eq!(h.client.quote(&1_000i128), 876);
    assert_eq!(h.client.discount_amount(&1_000i128), 124);
}

#[test]
fn quote_zero_face_value_fails() {
    let h = setup();
    assert_eq!(h.client.try_quote(&0i128), Err(Ok(Error::InvalidAmount)));
}

// ---- fund_invoice ----------------------------------------------------------

#[test]
fn fund_invoice_advances_discounted_amount() {
    let h = setup();
    let lp = Address::generate(&h.env);
    let farmer = Address::generate(&h.env);
    h.client.deposit(&lp, &10_000i128);

    let advance = h.client.fund_invoice(&h.admin, &1u64, &1_000i128, &farmer);
    assert_eq!(advance, 900);
    assert_eq!(h.client.balance_of(&farmer), 900);
    assert_eq!(h.client.available_liquidity(), 9_100);

    let funding = h.client.get_funding(&1u64);
    assert_eq!(funding.invoice_id, 1);
    assert_eq!(funding.face_value, 1_000);
    assert_eq!(funding.advance, 900);
    assert_eq!(funding.recipient, farmer);
    assert!(h.client.is_funded(&1u64));
}

#[test]
fn fund_invoice_requires_admin_auth() {
    let h = setup();
    let lp = Address::generate(&h.env);
    let farmer = Address::generate(&h.env);
    h.client.deposit(&lp, &10_000i128);
    h.client.fund_invoice(&h.admin, &1u64, &1_000i128, &farmer);
    assert_eq!(h.env.auths().first().unwrap().0, h.admin);
}

// ---- edge case: zero-value funding -----------------------------------------

#[test]
fn fund_invoice_zero_face_value_fails() {
    let h = setup();
    let lp = Address::generate(&h.env);
    let farmer = Address::generate(&h.env);
    h.client.deposit(&lp, &10_000i128);
    assert_eq!(
        h.client.try_fund_invoice(&h.admin, &1u64, &0i128, &farmer),
        Err(Ok(Error::InvalidAmount))
    );
}

#[test]
fn fund_invoice_negative_face_value_fails() {
    let h = setup();
    let lp = Address::generate(&h.env);
    let farmer = Address::generate(&h.env);
    h.client.deposit(&lp, &10_000i128);
    assert_eq!(
        h.client.try_fund_invoice(&h.admin, &1u64, &-100i128, &farmer),
        Err(Ok(Error::InvalidAmount))
    );
}

// ---- edge case: duplicate invoice ids --------------------------------------

#[test]
fn fund_invoice_duplicate_id_fails() {
    let h = setup();
    let lp = Address::generate(&h.env);
    let farmer = Address::generate(&h.env);
    h.client.deposit(&lp, &10_000i128);
    h.client.fund_invoice(&h.admin, &1u64, &1_000i128, &farmer);
    assert_eq!(
        h.client.try_fund_invoice(&h.admin, &1u64, &500i128, &farmer),
        Err(Ok(Error::AlreadyFunded))
    );
    // Liquidity only reduced once.
    assert_eq!(h.client.available_liquidity(), 9_100);
}

// ---- edge case: insufficient liquidity -------------------------------------

#[test]
fn fund_invoice_insufficient_liquidity_fails() {
    let h = setup();
    let lp = Address::generate(&h.env);
    let farmer = Address::generate(&h.env);
    h.client.deposit(&lp, &500i128);
    // advance for 1000 face value is 900 > 500 available
    assert_eq!(
        h.client.try_fund_invoice(&h.admin, &1u64, &1_000i128, &farmer),
        Err(Ok(Error::InsufficientLiquidity))
    );
}

#[test]
fn get_funding_missing_fails() {
    let h = setup();
    assert_eq!(
        h.client.try_get_funding(&123u64),
        Err(Ok(Error::FundingNotFound))
    );
}

// ---- withdraw --------------------------------------------------------------

#[test]
fn withdraw_reduces_balance_and_liquidity() {
    let h = setup();
    let lp = Address::generate(&h.env);
    h.client.deposit(&lp, &1_000i128);
    h.client.withdraw(&lp, &400i128);
    assert_eq!(h.client.balance_of(&lp), 600);
    assert_eq!(h.client.available_liquidity(), 600);
}

#[test]
fn withdraw_requires_auth() {
    let h = setup();
    let lp = Address::generate(&h.env);
    h.client.deposit(&lp, &1_000i128);
    h.client.withdraw(&lp, &100i128);
    assert_eq!(h.env.auths().first().unwrap().0, lp);
}

#[test]
fn farmer_can_withdraw_advanced_funds() {
    let h = setup();
    let lp = Address::generate(&h.env);
    let farmer = Address::generate(&h.env);
    h.client.deposit(&lp, &10_000i128);
    h.client.fund_invoice(&h.admin, &1u64, &1_000i128, &farmer);
    h.client.withdraw(&farmer, &900i128);
    assert_eq!(h.client.balance_of(&farmer), 0);
    // 10_000 deposited, 900 advanced out of the pool then withdrawn by the
    // farmer => 10_000 - 900 = 9_100 still credited to the LP, but only
    // 10_000 - 900 (advance) - 900 (withdrawal) = 8_200 remains un-deployed.
    assert_eq!(h.client.available_liquidity(), 8_200);
    assert_eq!(h.client.balance_of(&lp), 10_000);
}

// ---- edge cases: withdraw guards -------------------------------------------

#[test]
fn withdraw_more_than_balance_fails() {
    let h = setup();
    let lp = Address::generate(&h.env);
    h.client.deposit(&lp, &1_000i128);
    assert_eq!(
        h.client.try_withdraw(&lp, &1_001i128),
        Err(Ok(Error::InsufficientBalance))
    );
}

#[test]
fn withdraw_zero_fails() {
    let h = setup();
    let lp = Address::generate(&h.env);
    h.client.deposit(&lp, &1_000i128);
    assert_eq!(
        h.client.try_withdraw(&lp, &0i128),
        Err(Ok(Error::InvalidAmount))
    );
}

#[test]
fn withdraw_unauthorized_account_has_no_balance() {
    let h = setup();
    let lp = Address::generate(&h.env);
    let stranger = Address::generate(&h.env);
    h.client.deposit(&lp, &1_000i128);
    // Stranger never deposited; claim is zero.
    assert_eq!(
        h.client.try_withdraw(&stranger, &100i128),
        Err(Ok(Error::InsufficientBalance))
    );
}

#[test]
fn withdraw_blocked_when_liquidity_locked_in_funding() {
    // LP deposits 1000, pool funds an invoice consuming 900 of liquidity.
    // The LP's *claim* is still 1000, but only 100 is withdrawable.
    let h = setup();
    let lp = Address::generate(&h.env);
    let farmer = Address::generate(&h.env);
    h.client.deposit(&lp, &1_000i128);
    h.client.fund_invoice(&h.admin, &1u64, &1_000i128, &farmer);

    assert_eq!(h.client.balance_of(&lp), 1_000);
    assert_eq!(h.client.available_liquidity(), 100);
    assert_eq!(
        h.client.try_withdraw(&lp, &1_000i128),
        Err(Ok(Error::InsufficientLiquidity))
    );
    // But the LP can withdraw up to the un-deployed remainder.
    h.client.withdraw(&lp, &100i128);
    assert_eq!(h.client.balance_of(&lp), 900);
}

// ---- role-based access control ---------------------------------------------

#[test]
fn liquidity_manager_role_can_fund_without_being_a_signer() {
    let h = setup();
    let lm = Address::generate(&h.env);
    let lp = Address::generate(&h.env);
    let farmer = Address::generate(&h.env);
    h.client.deposit(&lp, &10_000i128);

    assert_eq!(
        h.client.try_fund_invoice(&lm, &1u64, &1_000i128, &farmer),
        Err(Ok(Error::Unauthorized))
    );

    h.client.grant_role(&h.admin, &Role::LiquidityManager, &lm);
    h.client.fund_invoice(&lm, &1u64, &1_000i128, &farmer);
    assert!(h.client.is_funded(&1u64));
}

#[test]
fn non_admin_cannot_set_token_address() {
    let h = setup();
    let outsider = Address::generate(&h.env);
    let token = Address::generate(&h.env);
    assert_eq!(
        h.client
            .try_set_token_address(&outsider, &TokenContract::XLM, &token),
        Err(Ok(Error::NotASigner))
    );
}

#[test]
fn pauser_can_pause_and_blocks_deposit() {
    let h = setup();
    let pauser = Address::generate(&h.env);
    h.client.grant_role(&h.admin, &Role::Pauser, &pauser);
    h.client.pause(&pauser);
    assert!(h.client.is_paused());

    let lp = Address::generate(&h.env);
    assert_eq!(
        h.client.try_deposit(&lp, &100i128),
        Err(Ok(Error::ContractPaused))
    );

    h.client.unpause(&pauser);
    h.client.deposit(&lp, &100i128);
    assert_eq!(h.client.balance_of(&lp), 100);
}

#[test]
fn admin_transfer_full_flow() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FinancingPoolContract, ());
    let client = FinancingPoolContractClient::new(&env, &contract_id);

    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);
    let signers = signers_of(&env, &[s1.clone(), s2.clone()]);
    client.initialize(
        &signers,
        &2u32,
        &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS,
        &DISCOUNT_BPS,
    );

    let new_signer = Address::generate(&env);
    let new_signers = signers_of(&env, &[new_signer.clone()]);
    client.propose_admin_transfer(&s1, &new_signers, &1u32);
    client.confirm_admin_transfer(&s2);
    env.ledger().with_mut(|li| {
        li.sequence_number += MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS;
    });
    client.execute_admin_transfer(&s1);

    assert!(!client.is_signer(&s1));
    assert!(client.is_signer(&new_signer));
}
