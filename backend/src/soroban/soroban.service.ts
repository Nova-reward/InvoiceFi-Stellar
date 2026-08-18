import { Injectable, Logger } from '@nestjs/common';
import { ContractError, ContractErrorCode } from '../common/contract-error';

/**
 * Thin wrapper around the Soroban RPC.
 * In production this calls the deployed contract; in tests it is mocked.
 */
@Injectable()
export class SorobanService {
  private readonly logger = new Logger(SorobanService.name);

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

  /**
   * Submit a signed price update to the oracle aggregator contract.
   * The signature is verified on-chain by the contract.
   */
  async submitOraclePrice(params: {
    oracleContractId: string;
    submitterWallet: string;
    assetPair: string;
    price: number;
    signature: string;
  }): Promise<{ txHash: string }> {
    this.logger.log(
      `Submitting oracle price: ${params.assetPair} = ${params.price} from ${params.submitterWallet}`,
    );

    // Real implementation would:
    // 1. Build a Soroban transaction invoking oracle.submit_price
    // 2. Sign with the submitter's secret key
    // 3. Submit via Soroban RPC
    // 4. Return the transaction hash
    //
    // Example using stellar-sdk:
    // const server = new SorobanRpc.Server(this.sorobanRpcUrl);
    // const account = await server.getAccount(params.submitterWallet);
    // const tx = new TransactionBuilder(account, { ... })
    //   .addOperation(ContractOperation.invokeHostFunction({
    //     contractId: params.oracleContractId,
    //     functionName: 'submit_price',
    //     args: [Symbol(params.assetPair), params.price]
    //   }))
    //   .build();
    // const signedTx = tx.sign(submitterSecretKey);
    // const result = await server.sendTransaction(signedTx);

    throw new Error('Not implemented – replace with stellar-sdk call');
  }

  /**
   * Fetch the current aggregated price from the oracle contract.
   * Returns null if the price is stale or unavailable.
   */
  async getOraclePrice(params: {
    oracleContractId: string;
    assetPair: string;
  }): Promise<{ price: number; ledger: number } | null> {
    this.logger.debug(`Fetching oracle price for ${params.assetPair}`);

    // Real implementation would:
    // 1. Simulate a read-only call to oracle.get_price
    // 2. Parse the result (Option<(i128, u64)>)
    // 3. Return null if None, otherwise return (price, ledger)
    //
    // Example using stellar-sdk:
    // const server = new SorobanRpc.Server(this.sorobanRpcUrl);
    // const result = await server.simulateTransaction(
    //   params.oracleContractId,
    //   'get_price',
    //   [Symbol(params.assetPair)]
    // );
    // if (result.result?.xdr) {
    //   const decoded = decodeScVal(result.result.xdr);
    //   if (decoded.is_some()) {
    //     return { price: decoded.unwrap().0, ledger: decoded.unwrap().1 };
    //   }
    // }
    // return null;

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
