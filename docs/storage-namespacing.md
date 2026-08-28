# Contract Storage Namespacing Strategy

## Overview

In Soroban smart contracts, state data stored in persistent or instance storage is keyed by values of type `Val`. When multiple contracts interact within a shared environment or module structure, storage keys must be strictly namespaced to prevent key collisions and state corruption.

InvoiceFi enforces a mandatory **Contract Storage Namespacing Strategy** across all core contracts (`access-control`, `invoice`, `financing-pool`, and `settlement`).

---

## Strategy Details

Each contract defines a unique `CONTRACT_PREFIX` constant and wraps its `DataKey` enum inside a tuple key format `(Symbol, DataKey)`.

### 1. Prefix Definitions

| Contract | Constant Name | Value |
| --- | --- | --- |
| Access Control | `CONTRACT_PREFIX` | `"access_control"` |
| Invoice | `CONTRACT_PREFIX` | `"invoice"` |
| Financing Pool | `CONTRACT_PREFIX` | `"financing_pool"` |
| Settlement | `CONTRACT_PREFIX` | `"settlement"` |

### 2. Tuple Namespacing Pattern

Every `DataKey` implementation includes a helper method:

```rust
impl DataKey {
    pub fn namespaced_key(&self, env: &Env) -> (Symbol, DataKey) {
        (Symbol::new(env, CONTRACT_PREFIX), self.clone())
    }
}
```

When reading from or writing to storage, all contracts pass the namespaced key tuple instead of the raw `DataKey` variant:

```rust
let key = InvoiceDataKey::Invoice(id).namespaced_key(&env);
env.storage().persistent().set(&key, &amount);
```

---

## Automated Collision Detection

To guarantee that no collisions occur across contract boundaries:

1. **Integration Test Suite**: `contracts/integration-tests/tests/storage_key_collision_test.rs` validates payload uniqueness across all key variants and tests shared instance storage isolation.
2. **Automated Verification Script**: `./scripts/check-storage-keys.sh` (or `make check-storage-keys`) verifies unique `CONTRACT_PREFIX` declarations and runs the Rust test suite.
3. **Continuous Integration**: Checked automatically on push and pull requests via `.github/workflows/storage-collision-check.yml`.
