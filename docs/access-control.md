# Access Control

All three Soroban contracts (`invoice`, `financing-pool`, `settlement`) share a
single role-based access control (RBAC) implementation: the
[`access-control`](../contracts/access-control) crate. This replaces the
previous single-key admin pattern with an n-of-m multisig admin set plus a
small number of operational roles.

## Model

- **Admin** authority is held by an n-of-m signer set (`MultisigConfig`), not a
  single key. Any *one* current signer may authorize an ordinary admin-gated
  call (grant/revoke a role, adjust a fee, wire a contract address, pause,
  ...) — this mirrors a committee where any member can act day-to-day.
- **Changing who the signers are** (adding/removing signers or changing the
  threshold) is the one operation sensitive enough to require the full n-of-m
  confirmation flow *and* a minimum time-lock, so a single compromised or
  malicious signer cannot unilaterally seize control of the contract.
- **Operational roles** are plain single-key grants managed by the admin
  signer set, so day-to-day operational actions don't need to route through
  every admin signer. A current admin signer is automatically treated as a
  superuser over every operational role — `has_role`/`require_role` return
  true for a signer even without an explicit grant.

## Roles and justification

| Role | Justification | Wired into |
| --- | --- | --- |
| `Admin` | Not a grantable role — defined solely by membership in the signer set (see below). Reserved for the small set of operations sensitive enough to need committee sign-off in spirit (config changes, fee/escrow/token-address wiring, lifecycle status transitions). | All three contracts: config-setting functions, `invoice::update_status`. |
| `LiquidityManager` | Day-to-day capital-allocation decisions (advancing funds against an invoice) shouldn't require an admin signer's attention every time. Scoped narrowly to funding actions so a compromised operational key can move capital but can't touch the signer set, roles, or contract configuration. | `financing-pool::fund_invoice`, `invoice::fund`. |
| `Pauser` | An emergency stop needs to be reachable faster than the admin multisig flow (which is deliberately slow for signer-set changes) — a dedicated, narrowly-scoped incident-response role lets a smaller circle halt money-moving operations immediately. Can only pause/unpause; cannot change config, roles, or the signer set. | `pause`/`unpause` in all three contracts, gating `invoice::{mint,fund,transfer,transfer_from,approve,update_status}`, `financing-pool::{deposit,withdraw,fund_invoice}`, and `settlement::{settle_invoice,withdraw_fees}`. |
| `OracleWriter` | Reserved for a future price/data oracle integration. None of the three contracts currently read external price data, so this role is defined (per the minimum role vocabulary required) but not yet gated on any function. Grant/revoke works today; wiring it up is follow-up work once an oracle-consuming code path exists. | Not yet wired to any function. |

## Admin transfer: time-lock + n-of-m

Changing the signer set (`propose_admin_transfer` → `confirm_admin_transfer`
(repeated by each signer) → `execute_admin_transfer`) requires:

- At least the **current** threshold's worth of confirmations (including the
  proposer's, which is recorded automatically on proposal).
- The configured time-lock to have elapsed since the proposal, measured in
  ledger sequence numbers. The minimum enforced value is
  `MIN_ADMIN_TRANSFER_TIMELOCK_LEDGERS` (34,560 ledgers ≈ 48 hours at Stellar's
  ~5s ledger close time), matching the acceptance criteria's minimum
  48-ledger-hour requirement. Each contract's `initialize`/`init` rejects a
  smaller value.
- Any current signer can `cancel_admin_transfer` to withdraw an unwanted
  proposal before it executes.

This means no single signer — however senior — can unilaterally hand control
to a new set of keys; a takeover requires both a quorum of the *current*
signers and the delay window, giving the rest of the signer set (and anyone
watching on-chain activity) time to notice and react.

## Error codes

Every privileged operation is gated by a role check that returns a specific,
decodable error rather than a generic failure:

- `Unauthorized` — caller holds neither the required role nor admin-signer
  status.
- `NotASigner` — caller is not a current member of the admin signer set
  (used by admin-only operations specifically, e.g. role grants/revokes,
  config changes, and every step of the admin-transfer flow).
- `ContractPaused` / `AlreadyPaused` / `NotPaused` — pause-state guards.
- `InvalidThreshold`, `DuplicateSigner`, `InvalidTimelock` — signer-set
  validation on `initialize`/`propose_admin_transfer`.
- `NoPendingTransfer`, `AlreadyConfirmed`, `ThresholdNotMet`,
  `TimelockNotElapsed` — admin-transfer flow guards.
- `CannotGrantAdminRole` — `Admin` cannot be granted via `grant_role`; it is
  only ever changed via the admin-transfer flow above.

`invoice` and `financing-pool` surface these as their own `#[contracterror]`
`Error` enum (via a `From<access_control::AcError>` conversion, so each
contract keeps its own stable error numbering). `settlement`'s entry points
return `()`/`Option<T>` rather than `Result` (a pre-existing convention in
that contract), so role/multisig failures there surface via
`panic_with_error!` with the equivalent `SettlementError` variant — still a
specific, decodable error code, not an opaque string panic.

## Testing

- `contracts/access-control/src/test.rs` exhaustively covers the shared
  logic in isolation (via a minimal harness contract): role grant/revoke,
  unauthorized-access rejection, pause/unpause, and the full propose → confirm
  → time-lock → execute admin-transfer flow, including threshold-not-met and
  time-lock-not-elapsed rejections.
- Each contract's own test suite covers the same flows through its real
  entry points (not just the shared library), so the wiring itself — not just
  the underlying logic — is verified per contract.
