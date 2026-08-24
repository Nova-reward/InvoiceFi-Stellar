# v1 WASM Artifact Baseline

This directory holds the **v1 WASM binaries** used by CI to run upgrade
regression tests against the current contract source.

## Files

| File | Description |
|---|---|
| `invoice_contract.wasm` | Compiled release WASM for `invoice-contract` at the v1 baseline |
| `financing_pool_contract.wasm` | Compiled release WASM for `financing-pool-contract` at the v1 baseline |
| `settlement_contract.wasm` | Compiled release WASM for `settlement-contract` at the v1 baseline |

## How to cut a new baseline

Run the pin script from the repository root:

```bash
bash scripts/pin-wasm-artifacts.sh
```

This builds all three contracts in release mode and copies the output WASMs
into this directory.  Commit the new WASMs and open a PR tagged
`chore: pin v<N> wasm baseline`.

## Versioning scheme

- The directory is named after the **from** version in the upgrade path,
  i.e. files here represent what is deployed on-chain before an upgrade.
- When a new version ships, move the current `v1/` artifacts to `v2/` (or
  the relevant version label) and re-pin `v1/` to the new baseline.
- CI always pulls from the directory whose name matches the `WASM_BASELINE`
  environment variable set in the workflow (defaults to `v1`).

## Why store WASMs in git?

The soroban-sdk test harness can load a WASM blob from a byte slice, so CI
can run "deploy v1 wasm, plant state, upgrade to current wasm, check
invariants" entirely in-process without a running network.  Committing the
WASMs ensures every developer and every CI run uses the same byte-for-byte
artifact, making tests fully deterministic.

> **Git LFS** is recommended for repositories that accumulate many WASM
> versions.  Add a `.gitattributes` entry:
> ```
> contracts/wasm-artifacts/**/*.wasm filter=lfs diff=lfs merge=lfs -text
> ```
