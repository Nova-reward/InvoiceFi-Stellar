export enum ContractErrorCode {
  InsufficientFunds = 'InsufficientFunds',
  InvoiceExpired = 'InvoiceExpired',
  DuplicateFunding = 'DuplicateFunding',
  Unauthorized = 'Unauthorized',
  InvalidState = 'InvalidState',
  WalletSessionExpired = 'WalletSessionExpired',
}

export class ContractError extends Error {
  constructor(
    public readonly code: ContractErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ContractError';
  }
}

/**
 * Numeric `#[contracterror]` codes exposed by `contracts/financing-pool`
 * (see `Error` in `financing-pool/src/lib.rs`), mapped to the closest
 * {@link ContractErrorCode}. Codes with no close analogue collapse to
 * `InvalidState` — a real but non-actionable-by-the-caller failure.
 */
export const FINANCING_POOL_ERROR_CODES: Record<number, ContractErrorCode> = {
  1: ContractErrorCode.InvalidState, // AlreadyInitialized
  2: ContractErrorCode.InvalidState, // NotInitialized
  3: ContractErrorCode.InvalidState, // InvalidAmount
  4: ContractErrorCode.InvalidState, // InvalidDiscount
  5: ContractErrorCode.InsufficientFunds, // InsufficientBalance
  6: ContractErrorCode.InsufficientFunds, // InsufficientLiquidity
  7: ContractErrorCode.DuplicateFunding, // AlreadyFunded
  8: ContractErrorCode.InvalidState, // FundingNotFound
  9: ContractErrorCode.InvalidState, // ReentrancyDetected
  10: ContractErrorCode.Unauthorized, // Unauthorized
  11: ContractErrorCode.Unauthorized, // NotASigner
  12: ContractErrorCode.InvalidState, // InvalidThreshold
  13: ContractErrorCode.InvalidState, // DuplicateSigner
  14: ContractErrorCode.InvalidState, // InvalidTimelock
  15: ContractErrorCode.InvalidState, // ContractPaused
  16: ContractErrorCode.InvalidState, // AlreadyPaused
  17: ContractErrorCode.InvalidState, // NotPaused
  18: ContractErrorCode.InvalidState, // NoPendingTransfer
  19: ContractErrorCode.InvalidState, // AlreadyConfirmed
  20: ContractErrorCode.InvalidState, // ThresholdNotMet
  21: ContractErrorCode.InvalidState, // TimelockNotElapsed
  22: ContractErrorCode.Unauthorized, // CannotGrantAdminRole
  23: ContractErrorCode.InvalidState, // StalePriceFeed
};

/**
 * Numeric `#[contracterror]` codes exposed by `contracts/settlement`
 * (see `SettlementError` in `settlement/src/error.rs`), mapped to the
 * closest {@link ContractErrorCode}.
 */
export const SETTLEMENT_ERROR_CODES: Record<number, ContractErrorCode> = {
  1: ContractErrorCode.Unauthorized, // Unauthorized
  2: ContractErrorCode.InvalidState, // AlreadySettled
  3: ContractErrorCode.InvalidState, // InvalidStatus
  4: ContractErrorCode.InvalidState, // ZeroAmount
  5: ContractErrorCode.InvalidState, // AlreadyAuthorized
  6: ContractErrorCode.Unauthorized, // NotAuthorized
  7: ContractErrorCode.InvalidState, // NonceReplay
  8: ContractErrorCode.InvalidState, // InvoiceNotFound
  9: ContractErrorCode.InvalidState, // InvalidAuthType
  10: ContractErrorCode.InsufficientFunds, // InsufficientFees
  11: ContractErrorCode.InvalidState, // ReentrancyDetected
  12: ContractErrorCode.InvalidState, // FinancingPoolNotSet
  13: ContractErrorCode.InvalidState, // CrossContractCallFailed
  14: ContractErrorCode.InvalidState, // AlreadyInitialized
  15: ContractErrorCode.InvalidState, // NotInitialized
  16: ContractErrorCode.Unauthorized, // NotASigner
  17: ContractErrorCode.InvalidState, // InvalidThreshold
  18: ContractErrorCode.InvalidState, // DuplicateSigner
  19: ContractErrorCode.InvalidState, // InvalidTimelock
  20: ContractErrorCode.InvalidState, // ContractPaused
  21: ContractErrorCode.InvalidState, // AlreadyPaused
  22: ContractErrorCode.InvalidState, // NotPaused
  23: ContractErrorCode.InvalidState, // NoPendingTransfer
  24: ContractErrorCode.InvalidState, // AlreadyConfirmed
  25: ContractErrorCode.InvalidState, // ThresholdNotMet
  26: ContractErrorCode.InvalidState, // TimelockNotElapsed
  27: ContractErrorCode.Unauthorized, // CannotGrantAdminRole
  28: ContractErrorCode.InvalidState, // InvalidAttestationSignature
  29: ContractErrorCode.InvalidState, // AttestationReplay
  30: ContractErrorCode.InvalidState, // EscrowPubkeyNotSet
  31: ContractErrorCode.InvalidState, // InvalidAttestationPayload
};

/** Which on-chain contract a Soroban call targeted, for error-code lookup. */
export type SorobanContractKind = 'financing-pool' | 'settlement';

/**
 * Non-contract transport/protocol failure talking to Soroban RPC — a
 * timeout, connection error, or a response that could not be parsed into
 * the shape the SDK expects. Distinct from {@link ContractError}, which
 * represents a well-formed rejection *from the contract itself*.
 */
export class SorobanRpcError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SorobanRpcError';
  }
}
