'use client';

import {
  Account,
  Address,
  Networks,
  Operation,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import type { TransactionSimulationRequest } from '../hooks/useTransactionSimulation';

/**
 * Build Soroban contract invocations on the client and fetch the account data
 * needed to construct a real, simulatable transaction.
 *
 * The produced base64 XDR is what gets (1) sent to the RPC's
 * `simulateTransaction` in `useTransactionSimulation`, and (2) handed to
 * Freighter's `signTransaction` once the preview is approved.
 */

const NETWORK_PASSPHRASE =
  (typeof process !== 'undefined' &&
    process.env?.STELLAR_NETWORK_PASSPHRASE) ||
  Networks.TESTNET;

const HORIZON_URL =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_HORIZON_URL) ||
  'http://localhost:8000';

export { NETWORK_PASSPHRASE };

export interface AccountSummary {
  /** Current account sequence number (string form from Horizon). */
  sequence: string;
  /** Native (XLM) spendable balance. */
  xlmBalance: number;
}

export interface ContractInvocationParams {
  contractId: string;
  functionName: string;
  args: xdr.ScVal[];
  sourceAddress: string;
  sourceAccountSeq: string;
  networkPassphrase?: string;
  /** Max fee to place on the transaction, in stroops. */
  feeStroops?: string;
}

/** Fetch the sequence number and XLM balance for an account from Horizon. */
export async function fetchAccountSummary(
  address: string,
  horizonUrl: string = HORIZON_URL,
): Promise<AccountSummary> {
  const response = await fetch(`${horizonUrl}/accounts/${address}`);
  if (!response.ok) {
    throw new Error(
      `Could not load account ${address} from Horizon. Check your wallet and network.`,
    );
  }
  const data = await response.json();
  const native = (data.balances ?? []).find(
    (balance: { asset_type: string }) => balance.asset_type === 'native',
  );
  return {
    sequence: data.sequence,
    xlmBalance: native ? Number(native.balance) : 0,
  };
}

/** Build a Soroban `Address` argument from a Stellar "G..." public key. */
export function scValAddress(address: string): xdr.ScVal {
  return xdr.ScVal.scvAddress(new Address(address).toScAddress());
}

/** Build a Soroban `u64` argument. */
export function scValU64(value: number | bigint): xdr.ScVal {
  return xdr.ScVal.scvU64(new xdr.Uint64(value));
}

/** Build a Soroban `i128` argument. */
export function scValI128(value: number | bigint): xdr.ScVal {
  return xdr.ScVal.scvI128(
    new xdr.Int128Parts({
      hi: new xdr.Int64(0),
      lo: new xdr.Uint64(value),
    }),
  );
}

/** Build the base64 XDR of a single contract-invocation transaction. */
export function buildContractInvocationXdr(
  params: ContractInvocationParams,
): string {
  const source = new Account(params.sourceAddress, params.sourceAccountSeq);

  const transaction = new TransactionBuilder(source, {
    fee: params.feeStroops ?? '100',
    networkPassphrase: params.networkPassphrase ?? NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: params.contractId,
        function: params.functionName,
        args: params.args,
      }),
    )
    .setTimeout(30)
    .build();

  return transaction.toXDR();
}

export interface BuildSimulationRequestParams {
  contractId: string;
  functionName: string;
  args: xdr.ScVal[];
  signerAddress: string;
  networkPassphrase?: string;
  horizonUrl?: string;
  rpcUrl?: string;
}

/**
 * Prepare a full [`TransactionSimulationRequest`] for a contract invocation:
 * resolves the signer's account (sequence + XLM balance), builds the
 * transaction XDR, and wires the display metadata the preview modal needs.
 *
 * Throws a human-readable error when the signer, Horizon or contract are not
 * reachable — the wizard surfaces that as a preflight error so the user is
 * never offered a "Sign" button for an unbuildable transaction.
 */
export async function buildSimulationRequest(
  params: BuildSimulationRequestParams,
): Promise<TransactionSimulationRequest> {
  if (!params.contractId) {
    throw new Error(
      'No contract configured. Add NEXT_PUBLIC_INVOICE_CONTRACT_ID to deploy the invoice contract.',
    );
  }
  if (!params.signerAddress) {
    throw new Error('No wallet connected. Connect your Freighter wallet first.');
  }

  const summary = await fetchAccountSummary(
    params.signerAddress,
    params.horizonUrl,
  );
  const transactionXdr = buildContractInvocationXdr({
    contractId: params.contractId,
    functionName: params.functionName,
    args: params.args,
    sourceAddress: params.signerAddress,
    sourceAccountSeq: summary.sequence,
    networkPassphrase: params.networkPassphrase,
  });

  return {
    transactionXdr,
    functionName: params.functionName,
    contractId: params.contractId,
    signerAddress: params.signerAddress,
    xlmBalance: summary.xlmBalance,
    rpcUrl: params.rpcUrl,
  };
}