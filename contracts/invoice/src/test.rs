#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String};

use crate::{ContractError, InvoiceContract, InvoiceContractClient, InvoiceStatus};

fn setup() -> (Env, InvoiceContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, InvoiceContract);
    let client = InvoiceContractClient::new(&env, &contract_id);
    (env, client)
}

fn make_invoice(client: &InvoiceContractClient, env: &Env) -> (Address, u64) {
    let owner = Address::generate(env);
    let id = client.create(
        &owner,
        &1000_i128,
        &String::from_str(env, "Harvest invoice"),
    );
    (owner, id)
}

// ── create ────────────────────────────────────────────────────────────────────

#[test]
fn test_create_sets_draft() {
    let (env, client) = setup();
    let (owner, id) = make_invoice(&client, &env);
    let inv = client.get(&id);
    assert_eq!(inv.owner, owner);
    assert_eq!(inv.status, InvoiceStatus::Draft);
    assert_eq!(inv.amount, 1000);
}

#[test]
fn test_create_increments_id() {
    let (env, client) = setup();
    let owner = Address::generate(&env);
    let id0 = client.create(&owner, &100, &String::from_str(&env, "a"));
    let id1 = client.create(&owner, &200, &String::from_str(&env, "b"));
    assert_eq!(id0, 0);
    assert_eq!(id1, 1);
}

// ── submit ────────────────────────────────────────────────────────────────────

#[test]
fn test_submit_draft_to_submitted() {
    let (env, client) = setup();
    let (owner, id) = make_invoice(&client, &env);
    client.submit(&owner, &id);
    assert_eq!(client.get(&id).status, InvoiceStatus::Submitted);
}

#[test]
fn test_submit_non_owner_fails() {
    let (env, client) = setup();
    let (_owner, id) = make_invoice(&client, &env);
    let other = Address::generate(&env);
    let err = client.try_submit(&other, &id).unwrap_err().unwrap();
    assert_eq!(err, ContractError::Unauthorized.into());
}

#[test]
fn test_submit_wrong_state_fails() {
    let (env, client) = setup();
    let (owner, id) = make_invoice(&client, &env);
    client.submit(&owner, &id); // now Submitted
    let err = client.try_submit(&owner, &id).unwrap_err().unwrap();
    assert_eq!(err, ContractError::InvalidTransition.into());
}

// ── fund ──────────────────────────────────────────────────────────────────────

#[test]
fn test_fund_submitted_to_funded() {
    let (env, client) = setup();
    let (owner, id) = make_invoice(&client, &env);
    client.submit(&owner, &id);
    let funder = Address::generate(&env);
    client.fund(&funder, &id);
    assert_eq!(client.get(&id).status, InvoiceStatus::Funded);
}

#[test]
fn test_fund_draft_fails() {
    let (env, client) = setup();
    let (_, id) = make_invoice(&client, &env);
    let funder = Address::generate(&env);
    let err = client.try_fund(&funder, &id).unwrap_err().unwrap();
    assert_eq!(err, ContractError::InvalidTransition.into());
}

#[test]
fn test_fund_already_funded_fails() {
    let (env, client) = setup();
    let (owner, id) = make_invoice(&client, &env);
    client.submit(&owner, &id);
    let funder = Address::generate(&env);
    client.fund(&funder, &id);
    let err = client.try_fund(&funder, &id).unwrap_err().unwrap();
    assert_eq!(err, ContractError::InvalidTransition.into());
}

// ── repay ─────────────────────────────────────────────────────────────────────

#[test]
fn test_repay_funded_to_repaid() {
    let (env, client) = setup();
    let (owner, id) = make_invoice(&client, &env);
    client.submit(&owner, &id);
    let funder = Address::generate(&env);
    client.fund(&funder, &id);
    client.repay(&owner, &id);
    assert_eq!(client.get(&id).status, InvoiceStatus::Repaid);
}

#[test]
fn test_repay_non_owner_fails() {
    let (env, client) = setup();
    let (owner, id) = make_invoice(&client, &env);
    client.submit(&owner, &id);
    let funder = Address::generate(&env);
    client.fund(&funder, &id);
    let err = client.try_repay(&funder, &id).unwrap_err().unwrap();
    assert_eq!(err, ContractError::Unauthorized.into());
}

#[test]
fn test_repay_wrong_state_fails() {
    let (env, client) = setup();
    let (owner, id) = make_invoice(&client, &env);
    client.submit(&owner, &id);
    let err = client.try_repay(&owner, &id).unwrap_err().unwrap();
    assert_eq!(err, ContractError::InvalidTransition.into());
}

// ── default ───────────────────────────────────────────────────────────────────

#[test]
fn test_default_funded_to_defaulted() {
    let (env, client) = setup();
    let (owner, id) = make_invoice(&client, &env);
    client.submit(&owner, &id);
    let funder = Address::generate(&env);
    client.fund(&funder, &id);
    client.default(&owner, &id);
    assert_eq!(client.get(&id).status, InvoiceStatus::Defaulted);
}

#[test]
fn test_default_non_owner_fails() {
    let (env, client) = setup();
    let (owner, id) = make_invoice(&client, &env);
    client.submit(&owner, &id);
    let funder = Address::generate(&env);
    client.fund(&funder, &id);
    let err = client.try_default(&funder, &id).unwrap_err().unwrap();
    assert_eq!(err, ContractError::Unauthorized.into());
}

#[test]
fn test_default_wrong_state_fails() {
    let (env, client) = setup();
    let (owner, id) = make_invoice(&client, &env);
    let err = client.try_default(&owner, &id).unwrap_err().unwrap();
    assert_eq!(err, ContractError::InvalidTransition.into());
}

// ── get ───────────────────────────────────────────────────────────────────────

#[test]
fn test_get_not_found() {
    let (_env, client) = setup();
    let err = client.try_get(&99).unwrap_err().unwrap();
    assert_eq!(err, ContractError::NotFound.into());
}

// ── terminal states are final ─────────────────────────────────────────────────

#[test]
fn test_repaid_is_terminal() {
    let (env, client) = setup();
    let (owner, id) = make_invoice(&client, &env);
    client.submit(&owner, &id);
    let funder = Address::generate(&env);
    client.fund(&funder, &id);
    client.repay(&owner, &id);
    // Cannot default after repaid
    let err = client.try_default(&owner, &id).unwrap_err().unwrap();
    assert_eq!(err, ContractError::InvalidTransition.into());
}

#[test]
fn test_defaulted_is_terminal() {
    let (env, client) = setup();
    let (owner, id) = make_invoice(&client, &env);
    client.submit(&owner, &id);
    let funder = Address::generate(&env);
    client.fund(&funder, &id);
    client.default(&owner, &id);
    // Cannot repay after defaulted
    let err = client.try_repay(&owner, &id).unwrap_err().unwrap();
    assert_eq!(err, ContractError::InvalidTransition.into());
}
