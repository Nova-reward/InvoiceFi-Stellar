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

const DUE_DATE: u64 = 1_900_000_000;
const DISCOUNT_RATE: u32 = 1_000; // 10%

fn mint_default(h: &Harness, owner: &Address) -> u64 {
    h.client.mint(
        owner,
        &1_000i128,
        &symbol_short!("MAIZE"),
        &DUE_DATE,
        &String::from_str(&h.env, "ipfs://valuation"),
    )
}

/// Mint then fund (tokenize) an invoice, returning its id.
fn mint_and_fund(h: &Harness, owner: &Address) -> u64 {
    let id = mint_default(h, owner);
    h.client.fund(&id, &DISCOUNT_RATE);
    id
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
    h.client.fund(&id, &DISCOUNT_RATE);
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
    h.client.fund(&id, &DISCOUNT_RATE);
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
    h.client.fund(&id, &DISCOUNT_RATE);
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

    h.client.update_status(&id, &Status::Defaulted);
    // The status change must have been authorized by the admin.
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

// ---- tokenization: fund / mint token ---------------------------------------

#[test]
fn fund_mints_token_with_metadata() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let id = mint_default(&h, &owner);

    assert!(!h.client.is_tokenized(&id));
    h.client.fund(&id, &DISCOUNT_RATE);

    assert!(h.client.is_tokenized(&id));
    assert_eq!(h.client.status_of(&id), Status::Funded);

    let token = h.client.get_invoice_token(&id);
    assert_eq!(token.invoice_id, id);
    assert_eq!(token.face_value, 1_000);
    assert_eq!(token.discount_rate, DISCOUNT_RATE);
    assert_eq!(token.due_date, DUE_DATE);
}

#[test]
fn fund_requires_admin_auth() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let id = mint_default(&h, &owner);
    h.client.fund(&id, &DISCOUNT_RATE);
    assert_eq!(h.env.auths().first().unwrap().0, h.admin);
}

#[test]
fn fund_non_pending_fails() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let id = mint_and_fund(&h, &owner);
    // Already funded -> cannot fund again.
    assert_eq!(
        h.client.try_fund(&id, &DISCOUNT_RATE),
        Err(Ok(Error::InvalidTransition))
    );
}

#[test]
fn fund_invalid_discount_fails() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let id = mint_default(&h, &owner);
    assert_eq!(
        h.client.try_fund(&id, &10_000u32),
        Err(Ok(Error::InvalidDiscountRate))
    );
    // Funding never happened.
    assert!(!h.client.is_tokenized(&id));
    assert_eq!(h.client.status_of(&id), Status::Pending);
}

#[test]
fn fund_missing_invoice_fails() {
    let h = setup();
    assert_eq!(
        h.client.try_fund(&404u64, &DISCOUNT_RATE),
        Err(Ok(Error::InvoiceNotFound))
    );
}

// ---- tokenization: ownership queries ---------------------------------------

#[test]
fn get_invoice_token_owner_returns_owner() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let id = mint_and_fund(&h, &owner);
    assert_eq!(h.client.get_invoice_token_owner(&id), owner);
}

#[test]
fn get_invoice_token_owner_untokenized_fails() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let id = mint_default(&h, &owner); // minted but not funded
    assert_eq!(
        h.client.try_get_invoice_token_owner(&id),
        Err(Ok(Error::NotTokenized))
    );
}

#[test]
fn get_invoice_token_untokenized_fails() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let id = mint_default(&h, &owner);
    assert_eq!(
        h.client.try_get_invoice_token(&id),
        Err(Ok(Error::NotTokenized))
    );
}

// ---- tokenization: transfer rules ------------------------------------------

#[test]
fn funded_token_transfers_and_owner_query_follows() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    let id = mint_and_fund(&h, &owner);

    h.client.transfer(&owner, &buyer, &id);
    assert_eq!(h.client.owner_of(&id), buyer);
    assert_eq!(h.client.get_invoice_token_owner(&id), buyer);
}

#[test]
fn transfer_blocked_after_repayment() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    let id = mint_and_fund(&h, &owner);
    h.client.update_status(&id, &Status::Settled); // repaid

    assert_eq!(
        h.client.try_transfer(&owner, &buyer, &id),
        Err(Ok(Error::TransferAfterRepayment))
    );
    assert_eq!(h.client.owner_of(&id), owner);
}

#[test]
fn defaulted_token_can_still_transfer() {
    // Default is not repayment; the claim (bad debt) remains transferable.
    let h = setup();
    let owner = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    let id = mint_and_fund(&h, &owner);
    h.client.update_status(&id, &Status::Defaulted);

    h.client.transfer(&owner, &buyer, &id);
    assert_eq!(h.client.owner_of(&id), buyer);
}

// ---- tokenization: approve / transfer_from ---------------------------------

#[test]
fn approve_and_transfer_from() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let spender = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    let id = mint_and_fund(&h, &owner);

    h.client.approve(&owner, &spender, &id);
    assert_eq!(h.client.get_approved(&id), spender);

    h.client.transfer_from(&spender, &owner, &buyer, &id);
    assert_eq!(h.client.owner_of(&id), buyer);
    // Approval is consumed on transfer.
    assert_eq!(h.client.try_get_approved(&id), Err(Ok(Error::NotApproved)));
}

#[test]
fn transfer_from_without_approval_fails() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let spender = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    let id = mint_and_fund(&h, &owner);

    assert_eq!(
        h.client.try_transfer_from(&spender, &owner, &buyer, &id),
        Err(Ok(Error::NotApproved))
    );
}

#[test]
fn transfer_from_untokenized_fails() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let spender = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    let id = mint_default(&h, &owner); // not funded -> not tokenized

    assert_eq!(
        h.client.try_transfer_from(&spender, &owner, &buyer, &id),
        Err(Ok(Error::NotTokenized))
    );
}

#[test]
fn transfer_from_blocked_after_repayment() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let spender = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    let id = mint_and_fund(&h, &owner);
    h.client.approve(&owner, &spender, &id);
    h.client.update_status(&id, &Status::Settled);

    assert_eq!(
        h.client.try_transfer_from(&spender, &owner, &buyer, &id),
        Err(Ok(Error::TransferAfterRepayment))
    );
}

#[test]
fn approve_by_non_owner_fails() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let attacker = Address::generate(&h.env);
    let spender = Address::generate(&h.env);
    let id = mint_and_fund(&h, &owner);

    assert_eq!(
        h.client.try_approve(&attacker, &spender, &id),
        Err(Ok(Error::NotOwner))
    );
}

#[test]
fn approve_untokenized_fails() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let spender = Address::generate(&h.env);
    let id = mint_default(&h, &owner); // not funded

    assert_eq!(
        h.client.try_approve(&owner, &spender, &id),
        Err(Ok(Error::NotTokenized))
    );
}

#[test]
fn direct_transfer_clears_outstanding_approval() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let spender = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    let id = mint_and_fund(&h, &owner);

    h.client.approve(&owner, &spender, &id);
    h.client.transfer(&owner, &buyer, &id);
    // Stale approval from the previous owner must not survive.
    assert_eq!(h.client.try_get_approved(&id), Err(Ok(Error::NotApproved)));
}

#[test]
fn approve_requires_owner_auth() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let spender = Address::generate(&h.env);
    let id = mint_and_fund(&h, &owner);

    h.client.approve(&owner, &spender, &id);
    assert_eq!(h.env.auths().first().unwrap().0, owner);
}
