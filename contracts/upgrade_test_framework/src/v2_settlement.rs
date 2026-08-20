//! v2 test-double for the Settlement contract.
//!
//! Identical storage layout to v1.  Adds:
//! - `version() -> u32`  returns 2
//! - `upgrade(new_wasm: BytesN<32>)` (admin-only)

use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, Symbol};

use access_control::{AccessControl, MultisigConfig, PendingAdminTransfer, Role};
use settlement_contract::{AttestationRecord, InvoiceRecord, SettlementContract, SettlementTrait};

#[contract]
pub struct SettlementContractV2;

#[contractimpl]
impl SettlementContractV2 {
    // ── NEW in v2 ─────────────────────────────────────────────────────────────

    pub fn version(_env: Env) -> u32 {
        2
    }

    pub fn upgrade(env: Env, caller: Address, new_wasm: BytesN<32>) {
        caller.require_auth();
        AccessControl::require_admin(&env, &caller)
            .expect("upgrade: caller is not an admin signer");
        env.deployer().update_current_contract_wasm(new_wasm);
    }

    // ── Carried over from v1 ────────────────────────────────────────────────
    //
    // `env.register_at` (used by the test harness to simulate an upgrade)
    // swaps the registered contract type at the target address immediately
    // — unlike a real on-chain upgrade, it does not wait for an explicit
    // `upgrade()` call. So any v1 client still pointed at that address
    // starts dispatching to *this* type right away, and needs every v1
    // entry point available here too. These simply delegate to the v1
    // `SettlementContract`'s own implementation, which reads/writes the
    // same storage keys — no logic is duplicated.

    pub fn init(e: Env, signers: soroban_sdk::Vec<Address>, threshold: u32, timelock_ledgers: u32) {
        SettlementContract::init(e, signers, threshold, timelock_ledgers)
    }

    pub fn get_settlement_status(e: Env, invoice_id: Symbol) -> Option<u32> {
        SettlementContract::get_settlement_status(e, invoice_id)
    }

    pub fn get_settlement_auth_info(
        e: Env,
        invoice_id: Symbol,
        auth_count: u32,
    ) -> Option<(Address, bool)> {
        SettlementContract::get_settlement_auth_info(e, invoice_id, auth_count)
    }

    pub fn get_fee_rate(e: Env) -> Option<u32> {
        SettlementContract::get_fee_rate(e)
    }

    pub fn get_collected_fees(e: Env) -> Option<i128> {
        SettlementContract::get_collected_fees(e)
    }

    pub fn get_withdrawn_fees(e: Env) -> Option<i128> {
        SettlementContract::get_withdrawn_fees(e)
    }

    pub fn list_authorized_payers(e: Env) -> soroban_sdk::Vec<Address> {
        SettlementContract::list_authorized_payers(e)
    }

    pub fn list_financiers(e: Env) -> soroban_sdk::Vec<Address> {
        SettlementContract::list_financiers(e)
    }

    pub fn list_invoices(e: Env) -> soroban_sdk::Vec<Symbol> {
        SettlementContract::list_invoices(e)
    }

    pub fn set_authorized_payers(e: Env, caller: Address, payers: soroban_sdk::Vec<Address>) {
        SettlementContract::set_authorized_payers(e, caller, payers)
    }

    pub fn set_financiers(e: Env, caller: Address, financiers: soroban_sdk::Vec<Address>) {
        SettlementContract::set_financiers(e, caller, financiers)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_invoice_data(
        e: Env,
        caller: Address,
        invoice_id: Symbol,
        borrower: Address,
        financier: Address,
        amount: i128,
        due_date: u64,
        interest_rate: u32,
    ) {
        SettlementContract::set_invoice_data(
            e,
            caller,
            invoice_id,
            borrower,
            financier,
            amount,
            due_date,
            interest_rate,
        )
    }

    pub fn set_fee_rate(e: Env, caller: Address, fee_rate: u32) {
        SettlementContract::set_fee_rate(e, caller, fee_rate)
    }

    pub fn set_escrow_pubkey(e: Env, caller: Address, pubkey_bytes: BytesN<32>) {
        SettlementContract::set_escrow_pubkey(e, caller, pubkey_bytes)
    }

    pub fn submit_attestation(
        e: Env,
        caller: Address,
        payload_bytes: soroban_sdk::Bytes,
        sig_bytes: BytesN<64>,
    ) {
        SettlementContract::submit_attestation(e, caller, payload_bytes, sig_bytes)
    }

    pub fn get_attestation(e: Env, asset_pair: Symbol) -> Option<AttestationRecord> {
        SettlementContract::get_attestation(e, asset_pair)
    }

    pub fn settlement_auth(
        e: Env,
        caller: Address,
        invoice_id: Symbol,
        did_pay: bool,
        is_buyer: bool,
        is_payee: bool,
    ) {
        SettlementContract::settlement_auth(e, caller, invoice_id, did_pay, is_buyer, is_payee)
    }

    pub fn request_settlement_auth(e: Env, caller: Address, invoice_id: Symbol) {
        SettlementContract::request_settlement_auth(e, caller, invoice_id)
    }

    pub fn withdraw_fees(e: Env, caller: Address, to: Address, amount: i128) {
        SettlementContract::withdraw_fees(e, caller, to, amount)
    }

    pub fn get_invoice(e: Env, invoice_id: Symbol) -> Option<InvoiceRecord> {
        SettlementContract::get_invoice(e, invoice_id)
    }

    pub fn get_used_nonces(e: Env, invoice_id: Symbol) -> soroban_sdk::Vec<u64> {
        SettlementContract::get_used_nonces(e, invoice_id)
    }

    pub fn set_financing_pool_address(e: Env, caller: Address, pool_address: Address) {
        SettlementContract::set_financing_pool_address(e, caller, pool_address)
    }

    pub fn get_financing_pool_address(e: Env) -> Option<Address> {
        SettlementContract::get_financing_pool_address(e)
    }

    pub fn settle_invoice(
        e: Env,
        caller: Address,
        invoice_id: Symbol,
        nonce: u64,
        amount: i128,
        auth_type: u32,
    ) {
        SettlementContract::settle_invoice(e, caller, invoice_id, nonce, amount, auth_type)
    }

    // ---- access control ---------------------------------------------------

    pub fn multisig(e: Env) -> MultisigConfig {
        SettlementContract::multisig(e)
    }

    pub fn is_signer(e: Env, addr: Address) -> bool {
        SettlementContract::is_signer(e, addr)
    }

    pub fn has_role(e: Env, role: Role, addr: Address) -> bool {
        SettlementContract::has_role(e, role, addr)
    }

    pub fn is_paused(e: Env) -> bool {
        SettlementContract::is_paused(e)
    }

    pub fn grant_role(e: Env, caller: Address, role: Role, grantee: Address) {
        SettlementContract::grant_role(e, caller, role, grantee)
    }

    pub fn revoke_role(e: Env, caller: Address, role: Role, grantee: Address) {
        SettlementContract::revoke_role(e, caller, role, grantee)
    }

    pub fn pause(e: Env, caller: Address) {
        SettlementContract::pause(e, caller)
    }

    pub fn unpause(e: Env, caller: Address) {
        SettlementContract::unpause(e, caller)
    }

    pub fn propose_admin_transfer(
        e: Env,
        caller: Address,
        new_signers: soroban_sdk::Vec<Address>,
        new_threshold: u32,
    ) {
        SettlementContract::propose_admin_transfer(e, caller, new_signers, new_threshold)
    }

    pub fn confirm_admin_transfer(e: Env, caller: Address) {
        SettlementContract::confirm_admin_transfer(e, caller)
    }

    pub fn execute_admin_transfer(e: Env, caller: Address) {
        SettlementContract::execute_admin_transfer(e, caller)
    }

    pub fn cancel_admin_transfer(e: Env, caller: Address) {
        SettlementContract::cancel_admin_transfer(e, caller)
    }

    pub fn pending_admin_transfer(e: Env) -> Option<PendingAdminTransfer> {
        SettlementContract::pending_admin_transfer(e)
    }
}
