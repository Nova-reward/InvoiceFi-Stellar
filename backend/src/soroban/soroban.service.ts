import { Injectable } from '@nestjs/common';
import { ContractError, ContractErrorCode } from '../common/contract-error';

/**
 * Thin wrapper around the Soroban RPC.
 * In production this calls the deployed contract; in tests it is mocked.
 */
@Injectable()
export class SorobanService {
  async fundInvoice(params: {
    invoiceContractId: string;
    investorWallet: string;
    amount: number;
  }): Promise<{ txHash: string }> {
    // Real implementation would use stellar-sdk SorobanRpc.Server here.
    // Errors from the contract are mapped to typed ContractError instances.
    throw new Error('Not implemented – replace with stellar-sdk call');
  }

  async settleInvoice(params: {
    invoiceContractId: string;
    callerWallet: string;
  }): Promise<{ txHash: string }> {
    throw new Error('Not implemented – replace with stellar-sdk call');
  }

  /** Parse a raw Soroban diagnostic error string into a typed ContractError. */
  parseContractError(raw: string): ContractError {
    if (raw.includes('InsufficientFunds')) {
      return new ContractError(ContractErrorCode.InsufficientFunds, 'Wallet balance is insufficient');
    }
    if (raw.includes('InvoiceExpired')) {
      return new ContractError(ContractErrorCode.InvoiceExpired, 'Invoice has passed its expiry timestamp');
    }
    if (raw.includes('DuplicateFunding')) {
      return new ContractError(ContractErrorCode.DuplicateFunding, 'Invoice has already been funded');
    }
    if (raw.includes('Unauthorized')) {
      return new ContractError(ContractErrorCode.Unauthorized, 'Caller is not authorized to perform this action');
    }
    if (raw.includes('InvalidState')) {
      return new ContractError(ContractErrorCode.InvalidState, 'Invoice is in an invalid state for this operation');
    }
    return new ContractError(ContractErrorCode.InvalidState, raw);
  }
}
