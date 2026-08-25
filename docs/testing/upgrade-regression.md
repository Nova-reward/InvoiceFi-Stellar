# Upgrade Regression Testing — Strategy & Guide

This document explains how InvoiceFi Stellar tests that on-chain contract
upgrades preserve data integrity and behavioral correctness across all three
contracts: **invoice**, **financing-pool**, and **settlement**.

---

## Table of Contents

1. [Why upgrade regression tests?](#why-upgrade-regression-tests)
2. [How the in-process upgrade simulation works](#how-the-in-process-upgrade-simulation-works)
3. [Required state patterns](#required-state-patterns)
4. [Test anatomy](#test-anatomy)
5. [Running tests locally](#running-tests-locally)
6. [Adding tests for a new version](#adding-tests-for-a-new-version)
7. [WASM artifact baseline](#wasm-artifact-baseline)
8. [CI integration and branch protection](#ci-integration-and-branch-protection)
9. [Troubleshooting](#troubleshooting)

---

## Why upgrade regression tests?

Soroban smart contracts are immutable once deployed, but they can be replaced
by uploading a new WASM blob to the ledger and calling
`env.deployer().update_current_contract_wasm(new_wasm_hash)`. The critical
property to preserve is **storage compatibility**: the new WASM must be able
to correctly read every value that the old WASM wrote, using the same XDR
serialization and the same `contracttype` keys.

A bug in the storage layout (e.g., a renamed enum variant, a field added in
the middle of a struct) silently breaks reads of pre-upgrade data, leading to
incorrect financial computations or failed transactions — without any panic or
error code that would make the bug obvious in normal unit tests.

Upgrade regression tests close this gap by:

- **Planting** specific state patterns using the v1 contract.
- **Upgrading** the WASM in the same sandbox environment.
- **Asserting** that every planted value is readable and behaviorally correct
  via v2 entry points.

---

## How the in-process upgrade simulation works

The soroban-sdk `Env` sandbox stores all persistent data keyed by **contract
address**, not by WASM hash. This means that re-registering a different Rust
type at the same address — which the sandbox supports via
`Env::register_at(contract_id, ContractType, ())` — has exactly the same
effect as an on-chain WASM upgrade: the executing code changes while the
ledger data remains unchanged.

### Step-by-step

```
1. deploy_v1()
   └── env.register(InvoiceContract, ())   # current production contract
   └── client_v1.initialize(…)

2. plant_state()
   └── client_v1.mint(…)
   └── client_v1.fund(…)
   └── client_v1.update_status(…)
   └── …

3. simulate_upgrade_to_v2()
   └── env.register_at(&contract_id, InvoiceContractV2, ())  # v2 test-double
   └── client_v2 = InvoiceContractV2Client::new(&env, &contract_id)

4. assert_invariants()
   └── assert_eq!(client_v2.get_invoice(&id).status, Status::Funded)
   └── assert_eq!(client_v2.version(), 2)
   └── …
```

No network, no Docker, no Stellar CLI — tests run in the same `cargo test`
pass as unit tests.

### The v2 test-double crate

`contracts/upgrade_test_framework/` contains v2 versions of all three
contracts. Each v2 is additive-only relative to v1:

- **Same `DataKey` enum** (same variants, same discriminants, same XDR).
- **Same struct fields** (adding fields is allowed only at the end; adding in
  the middle breaks XDR compatibility and is caught by the tests).
- **New**: a `version() -> u32` view that returns `2`.
- **New**: an admin-gated `upgrade(new_wasm: BytesN<32>)` entry point.

The test-double's `Cargo.toml` has dev-only path dependencies on all three
production contracts so it can reuse their error types and access-control
library.

---

## Required state patterns

The acceptance criteria require at minimum three state patterns per contract.

### Invoice contract

| Pattern | Description |
|---|---|
| Active (Pending) | Invoice minted but not yet funded |
| Funded | Invoice funded — status=Funded, ownership token exists |
| Partially-repaid (Settled) | Invoice has reached terminal Settled status |
| Defaulted | Invoice has reached terminal Defaulted status |
| Approval | Approval record planted, usable via `transfer_from` |
| Role grant | LiquidityManager role granted, still usable post-upgrade |
| Paused | Contract paused — mint blocked pre- and post-upgrade |
| Mixed garden | All the above states present simultaneously |

### Financing Pool contract

| Pattern | Description |
|---|---|
| LP balance | Liquidity deposited, balance and available_liquidity intact |
| Funded invoice | Funding record, advance, recipient, liquidity accounting |
| Post-withdrawal | State after partial farmer withdrawal |
| Discount config | discount_bps unchanged; `quote()` returns correct values |
| Role grant | LiquidityManager role intact |
| Paused | Contract paused — deposit blocked post-upgrade |
| Multi-funding garden | Multiple LPs + multiple invoice fundings simultaneously |

### Settlement contract

| Pattern | Description |
|---|---|
| InvoiceRecord | All fields intact (borrower, financier, amount, due_date, …) |
| Partial settlement | principal_paid reflects partial payment |
| Fully settled | Terminal Settled status; further settlement rejected |
| Fee counters | collected_fees, withdrawn_fees, fee_rate all persist |
| Nonces | Used nonces survive; replay still rejected |
| Financing pool address | Configured address survives |
| Admin + paused | Signer set and paused state survive together |

---

## Test anatomy

A typical upgrade regression test looks like this:

```rust
#[test]
fn upgrade_preserves_funded_invoice() {
    // 1. Deploy v1 and plant state
    let h = deploy_v1();
    let owner = Address::generate(&h.env);
    let id = mint_and_fund(&h, &owner);

    // 2. Simulate the WASM upgrade
    let v2 = simulate_upgrade_to_v2(&h.env, &h.contract_id);

    // 3. Assert invariants via v2 reads
    assert!(v2.is_tokenized(&id), "invoice must still be tokenized");
    assert_eq!(v2.status_of(&id), Status::Funded);
    let token = v2.get_invoice_token(&id);
    assert_eq!(token.face_value, 2_000);
    assert_eq!(token.discount_rate, 500);
}
```

Helper functions (`deploy_v1`, `simulate_upgrade_to_v2`, `mint_and_fund`) are
defined at the top of each `upgrade_tests.rs` file and kept minimal.

---

## Running tests locally

```bash
# Run all upgrade regression tests for the invoice contract
cd contracts
cargo test -p invoice-contract upgrade -- --nocapture

# Run all upgrade regression tests for the financing pool
cargo test -p financing-pool-contract upgrade -- --nocapture

# Run all upgrade regression tests for the settlement contract
cargo test -p settlement-contract upgrade -- --nocapture

# Run everything at once (unit + upgrade + reentrancy)
cargo test
```

All tests are pure Rust; no extra tools are required beyond a standard Rust
toolchain (no wasm32 target needed for unit tests).

---

## Adding tests for a new version

When a new contract version (v2 → v3, etc.) is ready:

### Checklist

- [ ] **1. Review the storage layout diff.**  Compare every `contracttype`
  enum variant and every struct field between the old and new versions. Any
  change that is not strictly additive (new variants at the end, new optional
  fields) is a breaking change and must be handled by a migration entry point
  in the new contract.

- [ ] **2. Create a vN+1 test-double** in `contracts/upgrade_test_framework/src/`.
  Copy the pattern from `v2_invoice.rs`: same storage layout as the *outgoing*
  version, plus `version()` and `upgrade()`.

- [ ] **3. Add new upgrade_tests.rs entries** (or a new `mod upgrade_v2_to_v3`)
  that plant state via the old client and assert invariants via the new client.

- [ ] **4. Cover all three required state patterns** (active, funded,
  partially-repaid) plus any new state introduced by the new version.

- [ ] **5. Run locally** and verify all new tests pass.

- [ ] **6. Pin a new WASM baseline** if the contract has been deployed to
  testnet/mainnet:
  ```bash
  bash scripts/pin-wasm-artifacts.sh
  git add contracts/wasm-artifacts/v2/
  git commit -m "chore: pin v2 wasm baseline"
  ```

- [ ] **7. Open a PR.**  The `upgrade-regression-gate` job will run
  automatically and must pass before merge.

---

## WASM artifact baseline

The directory `contracts/wasm-artifacts/v1/` holds the compiled WASM binaries
for the previous deployed version of each contract.  These are used to run
"deploy v1 WASM, plant state, upgrade to current WASM, assert invariants"
tests in CI.

To pin a new baseline:

```bash
bash scripts/pin-wasm-artifacts.sh
```

See `contracts/wasm-artifacts/v1/README.md` for the full versioning scheme.

> **Note**: The current test suite uses the in-process sandbox re-registration
> approach (no real WASM loading) because it requires no network and no
> compiled WASM bytes at test time.  The pinned WASM artifacts are available
> for integration tests that require a real WASM-level upgrade (e.g., on a
> local Stellar sandbox node).

---

## CI integration and branch protection

### Workflow

File: `.github/workflows/upgrade-regression.yml`

Three parallel jobs:
- `invoice-upgrade` — runs `cargo test -p invoice-contract upgrade`
- `financing-pool-upgrade` — runs `cargo test -p financing-pool-contract upgrade`
- `settlement-upgrade` — runs `cargo test -p settlement-contract upgrade`

A gate job `upgrade-regression-gate` aggregates results and fails if any
individual job failed.

### Making it a required status check

1. Go to **Settings → Branches → Branch protection rules** for `main` (and
   `develop`).
2. Enable **Require status checks to pass before merging**.
3. Add **`✅ Upgrade Regression Gate`** to the list of required checks.
4. (Optional) Also add **`Contract CI Gate`** if not already present.

### Test failure behavior

When an upgrade regression test fails:

1. The `upgrade-regression-gate` job exits with code 1.
2. GitHub marks the PR as "not mergeable."
3. The test log artifact (e.g., `invoice-upgrade-log`) is uploaded and
   available in the **Actions** tab for diagnosis.

---

## Troubleshooting

### "register_at: address already registered"

The sandbox does not allow re-registration at an already-occupied address by
default in some SDK versions. Ensure you are using `Env::register_at` (not
`Env::register`) and that the contract address comes from the initial
`register` call.

### Storage key mismatches after adding a field

If you add a field **in the middle** of a `contracttype` struct, the XDR
encoding changes and existing stored values will fail to deserialize (the
contract will panic on `get`). The test will catch this:

```
thread '...' panicked at 'called `Option::unwrap()` on a `None` value'
```

Fix: always add new fields **at the end** of structs. Never rename or reorder
existing fields or enum variants.

### Version gate: tests not appearing in output

If `cargo test -p invoice-contract upgrade -- --nocapture` returns "0 tests
run", ensure `mod upgrade_tests;` is wired inside `#[cfg(test)]` at the
bottom of `contracts/invoice/src/lib.rs` and that the file name is exactly
`upgrade_tests.rs`.
