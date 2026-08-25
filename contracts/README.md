# Soroban Smart Contracts

Rust / Soroban contracts powering the InvoiceFi protocol, organized as a Cargo
workspace.

| Crate                                  | Purpose                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------- |
| [`invoice`](./invoice)                 | Tokenizes harvest invoices: minting, ownership, metadata, lifecycle.    |
| [`financing-pool`](./financing-pool)   | LP liquidity, discounted invoice funding, withdrawals.                  |

> The `settlement` contract described in the root README is not yet implemented
> and is tracked separately.

## Prerequisites

- Rust (stable) with `rustfmt` and `clippy`:

  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  rustup component add rustfmt clippy
  ```

## Common commands

All commands are run from this `contracts/` directory.

```bash
cargo test --all        # run the full unit-test suite
cargo fmt --all --check  # verify formatting
cargo clippy --all-targets -- -D warnings  # lint
```

## Contracts

### `invoice`

A farmer mints an invoice representing a future crop yield. Each invoice carries
a face value, crop symbol, due date, free-form metadata, owner, and a lifecycle
status.

Lifecycle state machine:

```
Pending ──▶ Funded ──▶ Settled
   │            │
   └──▶ Defaulted ◀──┘
```

`Settled` and `Defaulted` are terminal. State transitions are admin-gated.
`Pending -> Funded` happens via `fund`, which also tokenizes the invoice (see
below); all other transitions go through `update_status`.

Public entry points: `initialize`, `mint`, `fund`, `transfer`, `update_status`,
`get_invoice`, `owner_of`, `status_of`, `total_minted`, `exists`, `admin`.

#### Tokenization (SEP-0041-style ownership token)

When an invoice is funded it is tokenized: a unique ownership token is minted
representing the transferable repayment claim. Invoices are non-fungible, so the
interface is NFT-flavored (one token per invoice) using SEP-0041 naming and the
approve / `transfer_from` delegation pattern.

- `fund(invoice_id, discount_rate)` — admin; funds a `Pending` invoice and mints
  its token, snapshotting metadata (invoice id, face value, discount rate, due
  date).
- `get_invoice_token(invoice_id)` — token metadata.
- `get_invoice_token_owner(invoice_id)` — current token owner.
- `is_tokenized(invoice_id)` — whether the invoice has been funded/tokenized.
- `transfer(from, to, invoice_id)` — owner transfer; **blocked once the invoice
  is repayment-settled**.
- `approve(owner, spender, invoice_id)` / `get_approved(invoice_id)` /
  `transfer_from(spender, from, to, invoice_id)` — delegated transfer; approval
  is consumed on a successful transfer and cleared on any direct transfer.

### `financing-pool`

Investors deposit liquidity; the pool advances discounted working capital
against invoices and the discount is retained as protocol yield. Balances are
tracked as internal ledger claims (a production deployment settles them through a
SEP-41 token in the settlement layer).

Public entry points: `initialize`, `deposit`, `withdraw`, `fund_invoice`,
`quote`, `discount_amount`, `balance_of`, `available_liquidity`, `discount_bps`,
`get_funding`, `is_funded`, `admin`.

The advance for a face value `F` at a discount of `bps` basis points is
`F * (10_000 - bps) / 10_000` (floor division — any rounding remainder is
retained by the pool, never over-advanced).

## Testing

Tests live in `#[cfg(test)]` modules (`src/test.rs`) and use
`soroban_sdk::testutils`. Coverage includes every public entry point plus the
edge cases called out in the issue: zero/negative-value funding, duplicate
invoice ids, unauthorized callers, illegal state transitions, and insufficient
liquidity / balance. CI runs `cargo test`, `cargo fmt --check`, and `clippy` on
every push and pull request (see `.github/workflows/contracts.yml`).
