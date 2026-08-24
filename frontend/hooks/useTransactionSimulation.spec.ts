import { renderHook, act } from '@testing-library/react';
import {
  STROOPS_PER_XLM,
  useTransactionSimulation,
  simulateTransactionRpc,
  humanizePreflightError,
  buildSimulationDetails,
  stroopsToXlm,
} from './useTransactionSimulation';
import type { TransactionSimulationRequest } from './useTransactionSimulation';

const baseRequest: TransactionSimulationRequest = {
  transactionXdr: 'AAAAAEF'
    + 'kJhc2U2NGVuY29kZWQ=',
  functionName: 'fund_invoice',
  contractId: 'CAMLTCONTRACT',
  signerAddress: 'GCONTRACTADDR',
  xlmBalance: 100,
  rpcUrl: 'http://example.test/rpc',
};

function mockFetchResponse(body: unknown, ok = true): jest.Mock {
  const fn = jest.fn().mockResolvedValue({
    ok,
    json: async () => body,
  });
  return fn;
}

const originalFetch = (globalThis as Record<string, unknown>).fetch;

function setFetch(impl: jest.Mock): void {
  (globalThis as Record<string, jest.Mock>).fetch = impl;
}

afterEach(() => {
  if (originalFetch) {
    (globalThis as Record<string, unknown>).fetch = originalFetch;
  } else {
    delete (globalThis as Record<string, unknown>).fetch;
  }
});

describe('stroopsToXlm', () => {
  it('converts stroops to XLM', () => {
    expect(stroopsToXlm(STROOPS_PER_XLM)).toBe(1);
    expect(stroopsToXlm(1500)).toBeCloseTo(0.00015);
  });
});

describe('simulateTransactionRpc', () => {
  it('returns EMPTY_TRANSACTION_XDR when no XDR is provided', async () => {
    const result = await simulateTransactionRpc({ ...baseRequest, transactionXdr: '' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('EMPTY_TRANSACTION_XDR');
  });

  it('returns NETWORK_ERROR when the RPC is unreachable', async () => {
    setFetch(jest.fn().mockRejectedValue(new Error('network down')));
    const result = await simulateTransactionRpc(baseRequest);
    expect(result).toEqual({ ok: false, error: 'NETWORK_ERROR' });
  });

  it('parses a successful simulation into a minResourceFee', async () => {
    const fetchMock = mockFetchResponse({
      result: { minResourceFee: '4321', cost: { cpuInstrutions: '200' } },
    });
    setFetch(fetchMock);

    const result = await simulateTransactionRpc(baseRequest);
    expect(result.ok).toBe(true);
    expect(result.minResourceFee).toBe(4321);

    const url = fetchMock.mock.calls[0][0];
    expect(url).toBe('http://example.test/rpc');
  });

  it('surfaces a preflight result.error from the RPC', async () => {
    setFetch(
      mockFetchResponse({ result: { error: 'ContractError: Invoice already funded' } }),
    );

    const result = await simulateTransactionRpc(baseRequest);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('already funded');
  });

  it('parses JSON-RPC error bodies on HTTP failures', async () => {
    setFetch(
      mockFetchResponse(
        {
          error: { message: 'service unavailable', data: { error: 'Unreachable' } },
        },
        false,
      ),
    );

    const result = await simulateTransactionRpc(baseRequest);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Unreachable');
  });

  it('returns INVALID_RPC_RESPONSE for non-JSON responses', async () => {
    setFetch(
      jest.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('not json');
        },
      }),
    );

    const result = await simulateTransactionRpc(baseRequest);
    expect(result).toEqual({ ok: false, error: 'INVALID_RPC_RESPONSE' });
  });
});

describe('humanizePreflightError', () => {
  it('maps known failures to plain-language messages', () => {
    expect(humanizePreflightError('InsufficientBalance')).toContain('insufficient balance');
    expect(humanizePreflightError('AlreadyFunded')).toContain('already been funded');
    expect(humanizePreflightError('InvoiceNotFound')).toContain('could not be found');
    expect(humanizePreflightError('NETWORK_ERROR')).toContain('Could not reach');
  });

  it('falls back to the raw message', () => {
    expect(humanizePreflightError('BizarreErrorGizmo')).toContain('BizarreErrorGizmo');
  });
});

describe('buildSimulationDetails', () => {
  it('computes the fee, balance impact and balance after', () => {
    const details = buildSimulationDetails(baseRequest, 1234);
    expect(details.estimatedFeeStroops).toBe(1234 + 100);
    expect(details.estimatedFeeXlm).toBeCloseTo(0.0001334);
    expect(details.xlmBalanceImpactXlm).toBeCloseTo(0.0001334);
    expect(details.xlmBalanceAfter).toBeCloseTo(99.9998666);
    expect(details.insufficientBalance).toBe(false);
    expect(details.functionName).toBe('fund_invoice');
    expect(details.contractId).toBe('CAMLTCONTRACT');
    expect(details.signerAddress).toBe('GCONTRACTADDR');
  });

  it('flags an insufficient balance', () => {
    const details = buildSimulationDetails({ ...baseRequest, xlmBalance: 0 }, 500000);
    expect(details.insufficientBalance).toBe(true);
    expect(details.xlmBalanceAfter).toBeLessThan(0);
  });

  it('leaves balance-after null when balance is unknown', () => {
    const details = buildSimulationDetails({ ...baseRequest, xlmBalance: undefined }, 1234);
    expect(details.xlmBalanceAfter).toBeNull();
    expect(details.insufficientBalance).toBe(false);
  });
});

describe('useTransactionSimulation', () => {
  it('starts idle with no details', () => {
    const { result } = renderHook(() => useTransactionSimulation());
    expect(result.current.status).toBe('idle');
    expect(result.current.details).toBeNull();
    expect(result.current.preflightError).toBeNull();
  });

  it('resolves to success with details on a successful simulation', async () => {
    setFetch(
      mockFetchResponse({ result: { minResourceFee: '4321' } }),
    );

    const { result } = renderHook(() => useTransactionSimulation());

    let ok = false;
    await act(async () => {
      ok = await result.current.simulate(baseRequest);
    });

    expect(ok).toBe(true);
    expect(result.current.status).toBe('success');
    expect(result.current.details?.estimatedFeeStroops).toBe(4321 + 100);
    expect(result.current.preflightError).toBeNull();
  });

  it('ends in error and disables nothing but exposes a preflight error', async () => {
    setFetch(
      mockFetchResponse({ result: { error: 'AlreadyFunded' } }),
    );

    const { result } = renderHook(() => useTransactionSimulation());

    let ok = true;
    await act(async () => {
      ok = await result.current.simulate(baseRequest);
    });

    expect(ok).toBe(false);
    expect(result.current.status).toBe('error');
    expect(result.current.details).toBeNull();
    expect(result.current.preflightError).toContain('already been funded');
  });

  it('reset clears the simulation state', async () => {
    setFetch(
      mockFetchResponse({ result: { error: 'AlreadyFunded' } }),
    );

    const { result } = renderHook(() => useTransactionSimulation());
    await act(async () => {
      await result.current.simulate(baseRequest);
    });
    expect(result.current.status).toBe('error');

    act(() => {
      result.current.reset();
    });
    expect(result.current.status).toBe('idle');
    expect(result.current.preflightError).toBeNull();
    expect(result.current.details).toBeNull();
  });
});