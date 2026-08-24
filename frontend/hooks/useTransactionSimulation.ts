'use client';

import { useCallback, useState } from 'react';

/**
 * Transaction simulation hook for Soroban contract invocations.
 *
 * Before a user signs a `fund_invoice` / `settle_invoice` transaction in
 * Freighter, we ask the Soroban RPC to simulate the transaction. If the
 * simulation fails, signing it on-chain would also fail and burn XLM on fees
 * — so we surface the preflight error up front and block signing.
 *
 * The hook is network-agnostic: it only needs the base64 transaction XDR and
 * display metadata (function name, contract id, signer address). Building the
 * XDR is the caller's job (see `lib/soroban.ts`).
 */

export const STROOPS_PER_XLM = 10_000_000;
/** Default per-operation base fee charged by Stellar, in stroops. */
export const BASE_FEE_STROOPS = 100;

export type SimulationStatus = 'idle' | 'simulating' | 'success' | 'error';

export interface TransactionSimulationRequest {
  /** Base64 XDR of the transaction to simulate. */
  transactionXdr: string;
  /** Contract function that will be invoked, e.g. "fund_invoice". */
  functionName: string;
  /** Contract ID (C...) of the contract being invoked. */
  contractId: string;
  /** Wallet address (G...) that will sign the transaction. */
  signerAddress: string;
  /** Current XLM balance of the signer, used to show balance impact. Optional. */
  xlmBalance?: number;
  /** Soroban RPC endpoint override. Defaults to the configured RPC URL. */
  rpcUrl?: string;
}

export interface SimulationDetails {
  /** Resource fee reported by the simulation plus the base fee, in stroops. */
  estimatedFeeStroops: number;
  /** `estimatedFeeStroops` expressed in XLM. */
  estimatedFeeXlm: number;
  /** XLM that will be deducted when the transaction is submitted. */
  xlmBalanceImpactXlm: number;
  /** Signer balance after the fee, or null when the balance is unknown. */
  xlmBalanceAfter: number | null;
  /** True when the signer does not have enough XLM to cover the fee. */
  insufficientBalance: boolean;
  contractId: string;
  functionName: string;
  signerAddress: string;
}

export interface TransactionSimulationState {
  status: SimulationStatus;
  details: SimulationDetails | null;
  /** Plain-language preflight error, populated when status is "error". */
  preflightError: string | null;
  simulate: (request: TransactionSimulationRequest) => Promise<boolean>;
  reset: () => void;
}

function publicEnv(key: string): string | undefined {
  if (typeof process === 'undefined') return undefined;
  return process.env?.[key];
}

export const DEFAULT_SOROBAN_RPC_URL =
  publicEnv('NEXT_PUBLIC_SOROBAN_RPC_URL') || 'http://localhost:8001';

export function stroopsToXlm(stroops: number): number {
  return stroops / STROOPS_PER_XLM;
}

export interface SimulateTransactionResponse {
  ok: boolean;
  error?: string;
  /** Resource fee reported by the simulation, in stroops. */
  minResourceFee?: number;
}

/**
 * Call the Soroban RPC `simulateTransaction` JSON-RPC method.
 *
 * Exported for unit testing; `useTransactionSimulation` wraps it.
 */
export async function simulateTransactionRpc(
  request: TransactionSimulationRequest,
): Promise<SimulateTransactionResponse> {
  if (!request.transactionXdr) {
    return { ok: false, error: 'EMPTY_TRANSACTION_XDR' };
  }

  const url = request.rpcUrl || DEFAULT_SOROBAN_RPC_URL;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'simulateTransaction',
        params: { transaction: request.transactionXdr },
      }),
    });
  } catch {
    return { ok: false, error: 'NETWORK_ERROR' };
  }

  let payload: {
    result?: { error?: unknown; minResourceFee?: unknown };
    error?: { message?: unknown; data?: { error?: unknown } };
  };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    return { ok: false, error: 'INVALID_RPC_RESPONSE' };
  }

  if (!response.ok) {
    const message =
      payload?.error?.data?.error ??
      payload?.error?.message ??
      `The Stellar RPC responded with HTTP ${response.status}.`;
    return { ok: false, error: String(message) };
  }

  const result = payload?.result;
  if (!result) {
    return { ok: false, error: 'The Stellar RPC returned an empty simulation result.' };
  }
  if (result.error) {
    return { ok: false, error: String(result.error) };
  }

  const minResourceFee = Number(result.minResourceFee ?? 0);
  if (!Number.isFinite(minResourceFee) || minResourceFee < 0) {
    return { ok: false, error: 'The Stellar RPC returned an invalid fee estimate.' };
  }

  return { ok: true, minResourceFee };
}

const PREFLIGHT_ERROR_MESSAGES: Array<[RegExp, string]> = [
  [
    /NETWORK_ERROR/,
    'Could not reach the Stellar network. Check your connection and try again.',
  ],
  [
    /INVALID_RPC_RESPONSE/i,
    'The Stellar network returned an unexpected response. Please try again.',
  ],
  [
    /EMPTY_TRANSACTION_XDR/,
    'A transaction could not be prepared. Connect your wallet and verify the Stellar network before signing.',
  ],
  [
    /insufficient balance|insufficient/i,
    'Your account has insufficient balance to pay for this transaction.',
  ],
  [
    /InvalidAccountSeq/i,
    'Your account sequence number is out of date. Refresh your wallet and try again.',
  ],
  [
    /CONTRACT_ERROR|ContractError|does not have authorization|unauthorized/i,
    'The contract rejected this transaction. You may not be authorized, or the invoice may be in an invalid state.',
  ],
  [
    /AlreadyFunded|DuplicateFunding|already been funded/i,
    'This invoice has already been funded.',
  ],
  [
    /InvalidTransition/i,
    'This invoice is not in a state that allows this action.',
  ],
  [
    /InvoiceNotFound|NotFound|not found/i,
    'The invoice or contract referenced by this transaction could not be found.',
  ],
  [
    /Unreachable/i,
    'The contract could not be reached. Verify the contract address and network.',
  ],
];

/** Turn a raw RPC error string into a message a farmer/investor can act on. */
export function humanizePreflightError(raw: string): string {
  for (const [pattern, message] of PREFLIGHT_ERROR_MESSAGES) {
    if (pattern.test(raw)) return message;
  }
  const trimmed = raw.trim();
  return trimmed ? `The simulation failed: ${trimmed}` : 'The transaction could not be simulated.';
}

export function buildSimulationDetails(
  request: TransactionSimulationRequest,
  minResourceFee: number,
): SimulationDetails {
  const estimatedFeeStroops = minResourceFee + BASE_FEE_STROOPS;
  const estimatedFeeXlm = stroopsToXlm(estimatedFeeStroops);

  const hasBalance = request.xlmBalance !== undefined && request.xlmBalance !== null;
  const xlmBalanceAfter = hasBalance ? request.xlmBalance! - estimatedFeeXlm : null;

  return {
    estimatedFeeStroops,
    estimatedFeeXlm,
    xlmBalanceImpactXlm: estimatedFeeXlm,
    xlmBalanceAfter,
    insufficientBalance: xlmBalanceAfter !== null && xlmBalanceAfter < 0,
    contractId: request.contractId,
    functionName: request.functionName,
    signerAddress: request.signerAddress,
  };
}

export function useTransactionSimulation(): TransactionSimulationState {
  const [status, setStatus] = useState<SimulationStatus>('idle');
  const [details, setDetails] = useState<SimulationDetails | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);

  const simulate = useCallback(
    async (request: TransactionSimulationRequest): Promise<boolean> => {
      setStatus('simulating');
      setDetails(null);
      setPreflightError(null);

      const response = await simulateTransactionRpc(request);
      if (!response.ok) {
        setStatus('error');
        setPreflightError(humanizePreflightError(response.error ?? ''));
        return false;
      }

      setStatus('success');
      setDetails(buildSimulationDetails(request, response.minResourceFee ?? 0));
      return true;
    },
    [],
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setDetails(null);
    setPreflightError(null);
  }, []);

  return { status, details, preflightError, simulate, reset };
}
