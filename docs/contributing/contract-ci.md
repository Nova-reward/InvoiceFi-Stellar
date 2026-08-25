# Contract CI Gate

## Overview

The Contract CI Gate is a specialized GitHub Actions workflow that runs
whenever a pull request modifies files under `contracts/`. It consists of
three complementary checks that go beyond the standard compile-and-test
pipeline:

1. **Storage Key Convention Linter** — validates on-chain storage key names
   follow documented conventions to prevent accidental key renames that
   would corrupt live state.
2. **Contract Simulation** — executes `soroban contract simulate` against
   every public entry point with representative inputs and fails the CI if
   any simulation returns an error.
3. **Resource Diff** — compares instruction count and fee estimates between
   the base branch and the PR branch, posting a performance regression
   report as a PR comment.

## Workflow

The CI is defined in `.github/workflows/contract-ci-gate.yml`. It is
triggered on pull requests that touch `contracts/**`, the workflow file
itself, or any of the scripts in `scripts/`.

```
PR opened/updated → detect changes → storage-key-lint (parallel)
                                  → simulate (parallel)
                                  → resource-diff (after simulate)
                                  → post PR comment
```

## Storage Key Conventions

### Rule 1: Instance keys use UPPER_SNAKE_CASE

Instance-level storage keys (used with `env.storage().instance()`) must be
string literals in `UPPER_SNAKE_CASE`. These are typically passed to
`StorageKey::instance("KEY_NAME")` or defined as `DataKey` enum variants.

```rust
// ✅ Correct
env.storage().instance().set(&DataKey::Admin, &admin);
env.storage().instance().set(&StorageKey::instance("FEE_RATE"), &rate);

// ❌ Wrong — lowercase instance key
env.storage().instance().set(&StorageKey::instance("fee_rate"), &rate);
```

### Rule 2: Category tags in composite keys use UPPER_SNAKE_CASE

`StorageKey::new("CATEGORY", "id")` uses a two-part key where the category
serves as a namespace prefix. The category must be `UPPER_SNAKE_CASE`.

```rust
// ✅ Correct
StorageKey::new("INVOICE_DATA", id.as_str())
StorageKey::new("BALANCE", addr.to_string())

// ❌ Wrong — lowercase category
StorageKey::new("invoice_data", id.as_str())
```

### Rule 3: DataKey enum variants use PascalCase

Rust enum variants defined with `#[contracttype]` follow standard Rust
PascalCase conventions. The linter flags any variant that starts with a
lowercase letter.

### Rule 4: Event symbols use snake_case

Event topic symbols (typically `Symbol::new(&e, "event_name")`) use
`snake_case` to distinguish them from storage keys. This convention is
documented here but enforced by code review rather than automation.

### Rule 5: Symbol::short uses short uppercase identifiers

`symbol_short!("...")` is used for short (≤9 character) fixed identifiers
such as crop types. These should be short uppercase strings.

## Adding a New Contract

1. Add the contract directory under `contracts/`.
2. Add its entry points and representative arguments to the
   `CONTRACT_ENTRY_POINTS` map in `scripts/contract-simulate.sh`.
3. Ensure all storage keys follow the naming conventions above.
4. The CI gate will automatically pick it up on the next PR.

## Representative Test Inputs

Each entry point in `scripts/contract-simulate.sh` is called with
pre-defined representative arguments. These are chosen to exercise the
happy path with realistic data. The goal is not exhaustive fuzzing but a
smoke test that detects:

- Entry points that panic or trap with normal inputs
- Broken serialization/deserialization of arguments
- Resource usage regressions between branches

To add or update inputs for a contract, edit the
`CONTRACT_ENTRY_POINTS` associative array in the script.

## Resource Diff

The resource diff job:

1. Runs simulation on the PR branch (`scripts/contract-simulate.sh`).
2. Stashes changes, checks out the base branch, runs simulation there,
   then returns to the PR branch.
3. Diffs the two results using `scripts/contract-resource-diff.sh`.
4. Posts a markdown table as a PR comment showing per-entry-point deltas
   for instruction count and fee estimates.

### What counts as a regression

A regression is flagged when a PR entry point uses **more instructions**
than the same entry point on the base branch. Small increases are normal
when adding functionality; the report is informational and intended to
surface unexpected bloat.

## Local Testing

You can run the checks locally:

```bash
# Lint storage keys
bash scripts/check-storage-keys.sh

# Run simulation (requires soroban CLI and Rust WASM target)
bash scripts/contract-simulate.sh

# Resource diff against main
BASE_BRANCH=origin/main bash scripts/contract-resource-diff.sh
```

## Required Dependencies

- Rust with `wasm32-unknown-unknown` target
- `soroban` CLI (via `brew install stellar-cli` or
  `stellar-org/stellar-cli` GitHub Action)
- `jq` (JSON processor, pre-installed on Ubuntu runners)
- `bash` ≥ 4.0
