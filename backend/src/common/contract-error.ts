export enum ContractErrorCode {
  InsufficientFunds = 'InsufficientFunds',
  InvoiceExpired = 'InvoiceExpired',
  DuplicateFunding = 'DuplicateFunding',
  Unauthorized = 'Unauthorized',
  InvalidState = 'InvalidState',
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
