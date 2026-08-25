#![cfg(test)]

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

struct Harness {
    env: Env,
    client: InvoiceContractClient<'static>,
    admin: Address,
}

fn signers_of(env: &Env, addrs: &[Address]) -> Vec<Address> {
    let mut v = Vec::new(env);
    for a in addrs {
        v.push_back(a.clone());
    }
    v
}

/// Single-signer (1-of-1) admin set, at the minimum allowed time-lock —
/// functionally equivalent to the old single-admin model for tests that
/// don't specifically exercise multisig behavior.
fn setup() -> Harness {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(InvoiceContract, ());
    let client = InvoiceContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signers = signers_of(&env, &[admin.clone()]);
    client.initialize(&signers, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);
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
    h.client.fund(&h.admin, &id, &DISCOUNT_RATE);
    id
}

// ---- initialization --------------------------------------------------------

#[test]
fn initialize_sets_admin_and_zero_counter() {
    let h = setup();
    assert!(h.client.is_signer(&h.admin));
    let cfg = h.client.multisig();
    assert_eq!(cfg.threshold, 1);
    assert_eq!(cfg.signers, signers_of(&h.env, &[h.admin.clone()]));
    assert_eq!(h.client.total_minted(), 0);
    assert!(!h.client.is_paused());
}

#[test]
fn initialize_twice_fails() {
    let h = setup();
    let other = signers_of(&h.env, &[Address::generate(&h.env)]);
    assert_eq!(
        h.client.try_initialize(&other, &1u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS),
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
    h.client.fund(&h.admin, &id, &DISCOUNT_RATE);
    assert_eq!(h.client.status_of(&id), Status::Funded);
    h.client.update_status(&h.admin, &id, &Status::Settled);
    assert_eq!(h.client.status_of(&id), Status::Settled);
}

#[test]
fn pending_can_default() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let id = mint_default(&h, &owner);
    h.client.update_status(&h.admin, &id, &Status::Defaulted);
    assert_eq!(h.client.status_of(&id), Status::Defaulted);
}

#[test]
fn funded_can_default() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let id = mint_default(&h, &owner);
    h.client.fund(&h.admin, &id, &DISCOUNT_RATE);
    h.client.update_status(&h.admin, &id, &Status::Defaulted);
    assert_eq!(h.client.status_of(&id), Status::Defaulted);
}

#[test]
fn illegal_transition_pending_to_settled_fails() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let id = mint_default(&h, &owner);
    assert_eq!(
        h.client.try_update_status(&h.admin, &id, &Status::Settled),
        Err(Ok(Error::InvalidTransition))
    );
}

#[test]
fn terminal_settled_is_immutable() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let id = mint_default(&h, &owner);
    h.client.fund(&h.admin, &id, &DISCOUNT_RATE);
    h.client.update_status(&h.admin, &id, &Status::Settled);
    assert_eq!(
        h.client.try_update_status(&h.admin, &id, &Status::Funded),
        Err(Ok(Error::InvalidTransition))
    );
    assert_eq!(
        h.client.try_update_status(&h.admin, &id, &Status::Defaulted),
        Err(Ok(Error::InvalidTransition))
    );
}

#[test]
fn status_update_requires_admin_auth() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let id = mint_default(&h, &owner);

    h.client.update_status(&h.admin, &id, &Status::Defaulted);
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
    h.client.fund(&h.admin, &id, &DISCOUNT_RATE);

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
    h.client.fund(&h.admin, &id, &DISCOUNT_RATE);
    assert_eq!(h.env.auths().first().unwrap().0, h.admin);
}

#[test]
fn fund_non_pending_fails() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let id = mint_and_fund(&h, &owner);
    // Already funded -> cannot fund again.
    assert_eq!(
        h.client.try_fund(&h.admin, &id, &DISCOUNT_RATE),
        Err(Ok(Error::InvalidTransition))
    );
}

#[test]
fn fund_invalid_discount_fails() {
    let h = setup();
    let owner = Address::generate(&h.env);
    let id = mint_default(&h, &owner);
    assert_eq!(
        h.client.try_fund(&h.admin, &id, &10_000u32),
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
        h.client.try_fund(&h.admin, &404u64, &DISCOUNT_RATE),
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
    h.client.update_status(&h.admin, &id, &Status::Settled); // repaid

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
    h.client.update_status(&h.admin, &id, &Status::Defaulted);

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
    h.client.update_status(&h.admin, &id, &Status::Settled);

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

// ---- role-based access control ---------------------------------------------

#[test]
fn liquidity_manager_role_can_fund_without_being_a_signer() {
    let h = setup();
    let lm = Address::generate(&h.env);
    let owner = Address::generate(&h.env);
    let id = mint_default(&h, &owner);

    // Not yet granted: fund is rejected.
    assert_eq!(
        h.client.try_fund(&lm, &id, &DISCOUNT_RATE),
        Err(Ok(Error::Unauthorized))
    );

    h.client.grant_role(&h.admin, &Role::LiquidityManager, &lm);
    assert!(h.client.has_role(&Role::LiquidityManager, &lm));
    h.client.fund(&lm, &id, &DISCOUNT_RATE);
    assert_eq!(h.client.status_of(&id), Status::Funded);

    h.client.revoke_role(&h.admin, &Role::LiquidityManager, &lm);
    let id2 = mint_default(&h, &owner);
    assert_eq!(
        h.client.try_fund(&lm, &id2, &DISCOUNT_RATE),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn non_admin_cannot_grant_roles() {
    let h = setup();
    let outsider = Address::generate(&h.env);
    let grantee = Address::generate(&h.env);
    assert_eq!(
        h.client
            .try_grant_role(&outsider, &Role::LiquidityManager, &grantee),
        Err(Ok(Error::NotASigner))
    );
}

#[test]
fn pauser_can_pause_and_blocks_mint() {
    let h = setup();
    let pauser = Address::generate(&h.env);
    h.client.grant_role(&h.admin, &Role::Pauser, &pauser);

    h.client.pause(&pauser);
    assert!(h.client.is_paused());

    let owner = Address::generate(&h.env);
    assert_eq!(
        h.client.try_mint(
            &owner,
            &1_000i128,
            &symbol_short!("MAIZE"),
            &DUE_DATE,
            &String::from_str(&h.env, "ipfs://x"),
        ),
        Err(Ok(Error::ContractPaused))
    );

    h.client.unpause(&pauser);
    assert!(!h.client.is_paused());
    mint_default(&h, &owner);
}

#[test]
fn admin_transfer_requires_threshold_and_timelock() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(InvoiceContract, ());
    let client = InvoiceContractClient::new(&env, &contract_id);

    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);
    let s3 = Address::generate(&env);
    let signers = signers_of(&env, &[s1.clone(), s2.clone(), s3.clone()]);
    client.initialize(&signers, &2u32, &MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS);

    let new_signer = Address::generate(&env);
    let new_signers = signers_of(&env, &[new_signer.clone()]);
    client.propose_admin_transfer(&s1, &new_signers, &1u32);
    assert_eq!(
        client.try_execute_admin_transfer(&s1),
        Err(Ok(Error::ThresholdNotMet))
    );

    client.confirm_admin_transfer(&s2);
    assert_eq!(
        client.try_execute_admin_transfer(&s1),
        Err(Ok(Error::TimelockNotElapsed))
    );

    env.ledger().with_mut(|li| {
        li.sequence_number += MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS;
    });
    client.execute_admin_transfer(&s1);

    assert!(!client.is_signer(&s1));
    assert!(client.is_signer(&new_signer));
    assert!(client.pending_admin_transfer().is_none());
}
