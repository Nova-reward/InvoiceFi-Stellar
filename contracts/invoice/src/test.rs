#![cfg(test)]

use super::*;
use soroban_sdk::{symbol_short, testutils::Address as _, Address, Env, String};

struct Harness {
    env: Env,
    client: InvoiceContractClient<'static>,
    admin: Address,
}

fn setup() -> Harness {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(InvoiceContract, ());
    let client = InvoiceContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    Harness { env, client, admin }
}

fn mint_default(h: &Harness, owner: &Address) -> u64 {
    h.client.mint(
        owner,
        &1_000i128,
        &symbol_short!("MAIZE"),
        &1_900_000_000u64,
        &String::from_str(&h.env, "ipfs://valuation"),
    )
}

// ---- initialization --------------------------------------------------------

#[test]
fn initialize_sets_admin_and_zero_counter() {
    let h = setup();
    assert_eq!(h.client.admin(), h.admin);
    assert_eq!(h.client.total_minted(), 0);
}

#[test]
fn initialize_twice_fails() {
    let h = setup();
    let other = Address::generate(&h.env);
    assert_eq!(
        h.client.try_initialize(&other),
        Err(Ok(Error::AlreadyInitialized))
    );
}

#[test]
fn mint_before_initialize_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(InvoiceContract, ());
    let client = InvoiceContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    assert_eq!(
        client.try_mint(
            &owner,
            &1_000i128,
            &symbol_short!("MAIZE"),
            &1u64,
            &String::from_str(&env, "x"),
        ),
        Err(Ok(Error::NotInitialized))
    );
}

// ---- mint ------------------------------------------------------------------

#[test]
fn mint_allocates_monotonic_ids_and_stores_record() {
    let h = setup();
    let owner = Address::generate(&h.env);

    let id1 = mint_default(&h, &owner);
    let id2 = mint_default(&h, &owner);
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    assert_eq!(h.client.total_minted(), 2);

    let inv = h.client.get_invoice(&id1);
    assert_eq!(inv.id, 1);
    assert_eq!(inv.owner, owner);
    assert_eq!(inv.amount, 1_000);
    assert_eq!(inv.crop, symbol_short!("MAIZE"));
    assert_eq!(inv.status, Status::Pending);
}

#[test]
fn mint_requires_owner_auth() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let amount = 1_000i128;
    let crop = symbol_short!("MAIZE");
    let due = 1_900_000_000u64;
    let meta = String::from_str(&h.env, "ipfs://valuation");

    h.client.mint(&owner, &amount, &crop, &due, &meta);

    let auths = h.env.auths();
    assert_eq!(auths.first().unwrap().0, owner);
}

// ---- edge case: zero / negative value --------------------------------------

#[test]
fn mint_zero_value_fails() {
    let h = setup();
    let owner = Address::generate(&h.env);
    assert_eq!(
        h.client.try_mint(
            &owner,
            &0i128,
            &symbol_short!("MAIZE"),
            &1u64,
            &String::from_str(&h.env, "x"),
        ),
        Err(Ok(Error::InvalidAmount))
    );
}

#[test]
fn mint_negative_value_fails() {
    let h = setup();
    let owner = Address::generate(&h.env);
    assert_eq!(
        h.client.try_mint(
            &owner,
            &-5i128,
            &symbol_short!("MAIZE"),
            &1u64,
            &String::from_str(&h.env, "x"),
        ),
        Err(Ok(Error::InvalidAmount))
    );
}

// ---- transfer --------------------------------------------------------------

#[test]
fn transfer_moves_ownership() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    let id = mint_default(&h, &owner);

    h.client.transfer(&owner, &buyer, &id);
    assert_eq!(h.client.owner_of(&id), buyer);
}

// ---- edge case: unauthorized / invalid transfer ----------------------------

#[test]
fn transfer_by_non_owner_fails() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let attacker = Address::generate(&h.env);
    let victim = Address::generate(&h.env);
    let id = mint_default(&h, &owner);

    // `attacker` authorizes, but is not the owner of record.
    assert_eq!(
        h.client.try_transfer(&attacker, &victim, &id),
        Err(Ok(Error::NotOwner))
    );
    assert_eq!(h.client.owner_of(&id), owner);
}

#[test]
fn transfer_to_self_fails() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let id = mint_default(&h, &owner);
    assert_eq!(
        h.client.try_transfer(&owner, &owner, &id),
        Err(Ok(Error::SameOwnerTransfer))
    );
}

#[test]
fn transfer_missing_invoice_fails() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    assert_eq!(
        h.client.try_transfer(&owner, &buyer, &999u64),
        Err(Ok(Error::InvoiceNotFound))
    );
}

// ---- state transitions -----------------------------------------------------

#[test]
fn full_lifecycle_pending_funded_settled() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let id = mint_default(&h, &owner);

    assert_eq!(h.client.status_of(&id), Status::Pending);
    h.client.update_status(&id, &Status::Funded);
    assert_eq!(h.client.status_of(&id), Status::Funded);
    h.client.update_status(&id, &Status::Settled);
    assert_eq!(h.client.status_of(&id), Status::Settled);
}

#[test]
fn pending_can_default() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let id = mint_default(&h, &owner);
    h.client.update_status(&id, &Status::Defaulted);
    assert_eq!(h.client.status_of(&id), Status::Defaulted);
}

#[test]
fn funded_can_default() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let id = mint_default(&h, &owner);
    h.client.update_status(&id, &Status::Funded);
    h.client.update_status(&id, &Status::Defaulted);
    assert_eq!(h.client.status_of(&id), Status::Defaulted);
}

#[test]
fn illegal_transition_pending_to_settled_fails() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let id = mint_default(&h, &owner);
    assert_eq!(
        h.client.try_update_status(&id, &Status::Settled),
        Err(Ok(Error::InvalidTransition))
    );
}

#[test]
fn terminal_settled_is_immutable() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let id = mint_default(&h, &owner);
    h.client.update_status(&id, &Status::Funded);
    h.client.update_status(&id, &Status::Settled);
    assert_eq!(
        h.client.try_update_status(&id, &Status::Funded),
        Err(Ok(Error::InvalidTransition))
    );
    assert_eq!(
        h.client.try_update_status(&id, &Status::Defaulted),
        Err(Ok(Error::InvalidTransition))
    );
}

#[test]
fn status_update_requires_admin_auth() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let id = mint_default(&h, &owner);

    h.client.update_status(&id, &Status::Funded);
    // The most recent status change must have been authorized by the admin.
    let auths = h.env.auths();
    assert_eq!(auths.first().unwrap().0, h.admin);
}

// ---- read views ------------------------------------------------------------

#[test]
fn exists_reflects_minting() {
    let h = setup();
    let owner = Address::generate(&h.env);
    assert!(!h.client.exists(&1u64));
    let id = mint_default(&h, &owner);
    assert!(h.client.exists(&id));
}

#[test]
fn get_missing_invoice_fails() {
    let h = setup();
    assert_eq!(
        h.client.try_get_invoice(&42u64),
        Err(Ok(Error::InvoiceNotFound))
    );
}
