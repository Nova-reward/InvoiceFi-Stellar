import { Account, Keypair, StrKey, nativeToScVal, rpc, xdr } from '@stellar/stellar-sdk';
import { SorobanService, SorobanRpcClient } from './soroban.service';
import { ContractErrorCode, SorobanRpcError } from '../common/contract-error';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const INVESTOR = Keypair.random().publicKey();

/** Builds a diagnostic event carrying a single string message, matching the shape simulateTransaction/sendTransaction return. */
function diagnosticEvent(message: string): xdr.DiagnosticEvent {
  // The published .d.ts for these xdr union types omits the (switch, value)
  // constructor signature that js-xdr actually generates at runtime; cast
  // through `any` to construct them directly rather than depending on a
  // helper API surface (e.g. named arm factories) that doesn't exist here.
  const ContractEventBodyCtor = xdr.ContractEventBody as unknown as new (
    aSwitch: number,
    value: xdr.ContractEventV0,
  ) => xdr.ContractEventBody;
  const ExtensionPointCtor = xdr.ExtensionPoint as unknown as new (aSwitch: number) => xdr.ExtensionPoint;

  const body = new ContractEventBodyCtor(
    0,
    new xdr.ContractEventV0({
      topics: [],
      data: nativeToScVal(message, { type: 'string' }),
    }),
  );
  const event = new xdr.ContractEvent({
    ext: new ExtensionPointCtor(0),
    contractId: null,
    type: xdr.ContractEventType.diagnostic(),
    body,
  });
  return new xdr.DiagnosticEvent({ inSuccessfulContractCall: false, event });
}

/** A fake RPC client that always succeeds, returning a fixed hash/value. */
function makeSuccessfulServer(hash = 'a'.repeat(64)): SorobanRpcClient {
  const account = new Account(Keypair.random().publicKey(), '1');
  return {
    getAccount: jest.fn().mockResolvedValue(account),
    simulateTransaction: jest.fn().mockResolvedValue({
      id: '1',
      latestLedger: 100,
      events: [],
      _parsed: true,
      transactionData: { build: () => undefined } as any,
      minResourceFee: '100',
      result: { auth: [], retval: nativeToScVal(true, { type: 'bool' }) },
    }),
    prepareTransaction: jest.fn().mockImplementation(async (tx) => tx),
    sendTransaction: jest
      .fn()
      .mockResolvedValue({ status: 'PENDING', hash, latestLedger: 100, latestLedgerCloseTime: 0 }),
    pollTransaction: jest.fn().mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.SUCCESS,
      txHash: hash,
      latestLedger: 101,
      latestLedgerCloseTime: 0,
      oldestLedger: 1,
      oldestLedgerCloseTime: 0,
      ledger: 100,
      createdAt: 0,
      applicationOrder: 1,
      feeBump: false,
      envelopeXdr: {} as any,
      resultXdr: {} as any,
      resultMetaXdr: {} as any,
      returnValue: nativeToScVal(true, { type: 'bool' }),
    }),
  };
}

/** A fake RPC client whose simulation fails with the given diagnostic error string. */
function makeSimulationErrorServer(errorMessage: string, events: xdr.DiagnosticEvent[] = []): SorobanRpcClient {
  const account = new Account(Keypair.random().publicKey(), '1');
  return {
    getAccount: jest.fn().mockResolvedValue(account),
    simulateTransaction: jest.fn().mockResolvedValue({
      id: '1',
      latestLedger: 100,
      events,
      _parsed: true,
      error: errorMessage,
    }),
    prepareTransaction: jest.fn(),
    sendTransaction: jest.fn(),
    pollTransaction: jest.fn(),
  };
}

describe('SorobanService – fundInvoice / settleInvoice (mocked RPC)', () => {
  it('fundInvoice submits a real XDR transaction and returns the tx hash', async () => {
    const server = makeSuccessfulServer('b'.repeat(64));
    const service = new SorobanService(undefined, undefined, server);

    const result = await service.fundInvoice({
      invoiceContractId: CONTRACT_ID,
      investorWallet: INVESTOR,
      amount: 1000,
    });

    expect(result).toEqual({ txHash: 'b'.repeat(64) });
    expect(server.getAccount).toHaveBeenCalled();
    expect(server.simulateTransaction).toHaveBeenCalled();
    expect(server.sendTransaction).toHaveBeenCalled();
    expect(server.pollTransaction).toHaveBeenCalled();
  });

  it('settleInvoice submits a real XDR transaction and returns the tx hash', async () => {
    const server = makeSuccessfulServer('c'.repeat(64));
    const service = new SorobanService(undefined, undefined, server);

    const result = await service.settleInvoice({
      invoiceContractId: CONTRACT_ID,
      callerWallet: INVESTOR,
    });

    expect(result).toEqual({ txHash: 'c'.repeat(64) });
  });

  it('signs the fee-bump transaction with the sponsor key when one is configured', async () => {
    const sponsor = Keypair.random();
    const server = makeSuccessfulServer();
    const configService = { get: (key: string) => (key === 'SOROBAN_SPONSOR_SECRET' ? sponsor.secret() : undefined) } as any;
    const service = new SorobanService(configService, undefined, server);

    const sendMock = server.sendTransaction as jest.Mock;
    await service.fundInvoice({ invoiceContractId: CONTRACT_ID, investorWallet: INVESTOR, amount: 500 });

    const submitted = sendMock.mock.calls[0][0];
    // A fee-bumped transaction carries an inner transaction distinct from itself.
    expect(submitted.innerTransaction).toBeDefined();
    expect(submitted.feeSource).toBe(sponsor.publicKey());
  });

  it('throws SorobanRpcError on RPC timeout without misclassifying it as a contract error', async () => {
    const server = makeSuccessfulServer();
    (server.getAccount as jest.Mock).mockRejectedValue(new Error('ETIMEDOUT: request timed out'));
    const service = new SorobanService(undefined, undefined, server);

    await expect(
      service.fundInvoice({ invoiceContractId: CONTRACT_ID, investorWallet: INVESTOR, amount: 1 }),
    ).rejects.toBeInstanceOf(SorobanRpcError);
  });

  it('throws SorobanRpcError when simulateTransaction returns a malformed/unparseable response', async () => {
    const server = makeSuccessfulServer();
    (server.simulateTransaction as jest.Mock).mockRejectedValue(new SyntaxError('Unexpected token in JSON'));
    const service = new SorobanService(undefined, undefined, server);

    await expect(
      service.settleInvoice({ invoiceContractId: CONTRACT_ID, callerWallet: INVESTOR }),
    ).rejects.toBeInstanceOf(SorobanRpcError);
  });

  it('maps a financing-pool contract panic surfaced at simulation time to ContractError', async () => {
    const server = makeSimulationErrorServer('HostError: Error(Contract, #7)'); // AlreadyFunded
    const service = new SorobanService(undefined, undefined, server);

    await expect(
      service.fundInvoice({ invoiceContractId: CONTRACT_ID, investorWallet: INVESTOR, amount: 1 }),
    ).rejects.toMatchObject({ name: 'ContractError', code: ContractErrorCode.DuplicateFunding });
  });

  it('maps a settlement contract panic (Unauthorized, code #1) using the settlement error table', async () => {
    const server = makeSimulationErrorServer('HostError: Error(Contract, #1)');
    const service = new SorobanService(undefined, undefined, server);

    await expect(
      service.settleInvoice({ invoiceContractId: CONTRACT_ID, callerWallet: INVESTOR }),
    ).rejects.toMatchObject({ name: 'ContractError', code: ContractErrorCode.Unauthorized });
  });

  it('decodes a diagnostic event message when no numeric code is present', async () => {
    const server = makeSimulationErrorServer('simulation failed', [diagnosticEvent('InsufficientBalance')]);
    const service = new SorobanService(undefined, undefined, server);

    await expect(
      service.fundInvoice({ invoiceContractId: CONTRACT_ID, investorWallet: INVESTOR, amount: 1 }),
    ).rejects.toMatchObject({ code: ContractErrorCode.InsufficientFunds });
  });
});

describe('SorobanService – parseContractError', () => {
  const service = new SorobanService();

  it.each([
    ['InsufficientFunds in diagnostic', 'Error: InsufficientFunds', ContractErrorCode.InsufficientFunds],
    ['InvoiceExpired in diagnostic', 'ContractError: InvoiceExpired', ContractErrorCode.InvoiceExpired],
    ['DuplicateFunding in diagnostic', 'vm trap: DuplicateFunding', ContractErrorCode.DuplicateFunding],
    ['Unauthorized in diagnostic', 'host fn trap: Unauthorized', ContractErrorCode.Unauthorized],
    ['InvalidState in diagnostic', 'panic: InvalidState', ContractErrorCode.InvalidState],
    ['WalletSessionExpired in diagnostic', 'Error: WalletSessionExpired', ContractErrorCode.WalletSessionExpired],
    ['wallet session wording', 'the wallet session has expired, please reconnect', ContractErrorCode.WalletSessionExpired],
  ])('parses %s → %s', (_label, raw, expected) => {
    const err = service.parseContractError(raw);
    expect(err.code).toBe(expected);
    expect(err.name).toBe('ContractError');
  });

  it('falls back to InvalidState for unknown errors', () => {
    const err = service.parseContractError('some unknown vm error');
    expect(err.code).toBe(ContractErrorCode.InvalidState);
  });

  it.each(
    // Every ContractErrorCode variant must be reachable via at least one diagnostic string.
    Object.values(ContractErrorCode),
  )('every ContractErrorCode variant %s has a mapped diagnostic string', (code) => {
    const samples: Record<ContractErrorCode, string> = {
      [ContractErrorCode.InsufficientFunds]: 'InsufficientFunds',
      [ContractErrorCode.InvoiceExpired]: 'InvoiceExpired',
      [ContractErrorCode.DuplicateFunding]: 'DuplicateFunding',
      [ContractErrorCode.Unauthorized]: 'Unauthorized',
      [ContractErrorCode.InvalidState]: 'InvalidState',
      [ContractErrorCode.WalletSessionExpired]: 'WalletSessionExpired',
    };
    expect(service.parseContractError(samples[code]).code).toBe(code);
  });
});
