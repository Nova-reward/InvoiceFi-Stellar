//! Shared test helpers used by all upgrade regression tests.

use soroban_sdk::{testutils::Ledger, Address, Env, Vec};

// ─────────────────────────────────────────────────────────────────────────────
// Address / signer helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Build a `Vec<Address>` from a slice in the given `env`.
pub fn make_signers(env: &Env, addrs: &[Address]) -> Vec<Address> {
    let mut v = Vec::new(env);
    for a in addrs {
        v.push_back(a.clone());
    }
    v
}

// ─────────────────────────────────────────────────────────────────────────────
// Ledger helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Advance the simulated ledger sequence by `n` ledgers (used to satisfy
/// time-lock requirements in admin-transfer tests).
pub fn advance_ledger(env: &Env, n: u32) {
    env.ledger().with_mut(|li| {
        li.sequence_number = li.sequence_number.saturating_add(n);
        // Advance the ledger timestamp proportionally (~5 s per ledger).
        li.timestamp = li.timestamp.saturating_add(n as u64 * 5);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// State-invariant assertion helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Assert that a post-upgrade invoice record matches the values planted before
/// the upgrade.  Fields checked: `id`, `owner`, `amount`, `due_date`, `status`.
pub fn assert_invoice_fields(
    id: u64,
    owner: &Address,
    amount: i128,
    due_date: u64,
    status_discriminant: u32, // Status as u32 for generic comparison
    actual_id: u64,
    actual_owner: &Address,
    actual_amount: i128,
    actual_due_date: u64,
    actual_status_discriminant: u32,
) {
    assert_eq!(
        actual_id, id,
        "invoice id mismatch after upgrade: expected {id}, got {actual_id}"
    );
    assert_eq!(actual_owner, owner, "invoice owner mismatch after upgrade");
    assert_eq!(
        actual_amount, amount,
        "invoice amount mismatch after upgrade: expected {amount}, got {actual_amount}"
    );
    assert_eq!(
        actual_due_date, due_date,
        "invoice due_date mismatch after upgrade"
    );
    assert_eq!(
        actual_status_discriminant, status_discriminant,
        "invoice status mismatch after upgrade: expected {status_discriminant}, got {actual_status_discriminant}"
    );
}

/// Assert that a funding record survives upgrade intact.
pub fn assert_funding_fields(
    invoice_id: u64,
    face_value: i128,
    advance: i128,
    recipient: &Address,
    actual_invoice_id: u64,
    actual_face_value: i128,
    actual_advance: i128,
    actual_recipient: &Address,
) {
    assert_eq!(
        actual_invoice_id, invoice_id,
        "funding.invoice_id mismatch after upgrade"
    );
    assert_eq!(
        actual_face_value, face_value,
        "funding.face_value mismatch after upgrade"
    );
    assert_eq!(
        actual_advance, advance,
        "funding.advance mismatch after upgrade"
    );
    assert_eq!(
        actual_recipient, recipient,
        "funding.recipient mismatch after upgrade"
    );
}
