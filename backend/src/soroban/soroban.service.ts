import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Address,
  BASE_FEE,
  Contract,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import {
  ContractError,
  ContractErrorCode,
  FINANCING_POOL_ERROR_CODES,
  SETTLEMENT_ERROR_CODES,
  SorobanContractKind,
  SorobanRpcError,
} from '../common/contract-error';
import { loadSigningKey } from '../compliance/signing';
import { VaultService } from '../config/vault/vault.service';

/** Minimal RPC surface this service depends on — narrowed so tests can supply a mock. */
export type SorobanRpcClient = Pick<
  rpc.Server,
  | 'getAccount'
  | 'simulateTransaction'
  | 'prepareTransaction'
  | 'sendTransaction'
  | 'pollTransaction'
>;

/** Default Soroban RPC/network config for local development against `docker-compose`'s `stellar-standalone`. */
const LOCAL_STANDALONE_RPC_URL = 'http://localhost:8000/soroban/rpc';
const LOCAL_STANDALONE_PASSPHRASE = 'Standalone Network ; February 2017';

const SUBMIT_POLL_ATTEMPTS = 15;

/**
 * Thin wrapper around the Soroban RPC.
 *
 * Builds, simulates, signs, and submits contract invocations for the
 * invoice financing flow, decodes results back to typed objects, and maps
 * on-chain / RPC failures to {@link ContractError} (contract panics) or
 * {@link SorobanRpcError} (transport-level failures — timeouts, malformed
 * responses).
 *
 * Signing key and (optional) fee-bump sponsor key are resolved the same way
 * the compliance module resolves its signing key (see
 * `../compliance/signing.ts#loadSigningKey`): a configured Stellar secret
 * seed if present, otherwise an ephemeral random key for local development.
 * Real custody/rotation of these secrets is out of scope here — this service
 * only consumes an already-resolved `Keypair`.
 */
@Injectable()
export class SorobanService {
  private readonly logger = new Logger(SorobanService.name);

  private server?: SorobanRpcClient;
  private signerKeypair?: Keypair;
  private sponsorKeypair?: Keypair;
  private networkPassphrase?: string;
  private rpcUrl?: string;

  constructor(
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly vault?: VaultService,
    /** Test-only seam: inject a fake RPC client instead of a real `rpc.Server`. */
    @Optional() private readonly serverOverride?: SorobanRpcClient,
  ) {}

  async fundInvoice(params: {
    invoiceContractId: string;
    investorWallet: string;
    amount: number;
  }): Promise<{ txHash: string }> {
    const contract = new Contract(params.invoiceContractId);
    const args = [
      nativeToScVal(Address.fromString(params.investorWallet), { type: 'address' }),
      nativeToScVal(BigInt(Math.trunc(params.amount)), { type: 'i128' }),
    ];
    return this.invoke(contract, 'fund_invoice', args, 'financing-pool');
  }

  async settleInvoice(params: {
    invoiceContractId: string;
    callerWallet: string;
  }): Promise<{ txHash: string }> {
    const contract = new Contract(params.invoiceContractId);
    const args = [nativeToScVal(Address.fromString(params.callerWallet), { type: 'address' })];
    return this.invoke(contract, 'settle_invoice', args, 'settlement');
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
  parseContractError(raw: string, kind?: SorobanContractKind): ContractError {
    const numericCode = this.extractNumericErrorCode(raw);
    if (numericCode !== undefined) {
      const table = kind === 'settlement' ? SETTLEMENT_ERROR_CODES : FINANCING_POOL_ERROR_CODES;
      const mapped = table[numericCode];
      if (mapped) {
        return new ContractError(mapped, `Contract error #${numericCode}: ${raw}`);
      }
    }

    if (/WalletSessionExpired|wallet session|session expired/i.test(raw)) {
      return new ContractError(ContractErrorCode.WalletSessionExpired, 'Wallet session has expired; reconnect and retry');
    }
    if (raw.includes('InsufficientFunds') || raw.includes('InsufficientBalance') || raw.includes('InsufficientLiquidity')) {
      return new ContractError(ContractErrorCode.InsufficientFunds, 'Wallet balance is insufficient');
    }
    if (raw.includes('InvoiceExpired')) {
      return new ContractError(ContractErrorCode.InvoiceExpired, 'Invoice has passed its expiry timestamp');
    }
    if (raw.includes('DuplicateFunding') || raw.includes('AlreadyFunded')) {
      return new ContractError(ContractErrorCode.DuplicateFunding, 'Invoice has already been funded');
    }
    if (raw.includes('Unauthorized') || raw.includes('NotAuthorized')) {
      return new ContractError(ContractErrorCode.Unauthorized, 'Caller is not authorized to perform this action');
    }
    if (raw.includes('InvalidState')) {
      return new ContractError(ContractErrorCode.InvalidState, raw);
    }
    return new ContractError(ContractErrorCode.InvalidState, raw);
  }

  // ── Core invocation flow ────────────────────────────────────────────────

  private async invoke(
    contract: Contract,
    method: string,
    args: xdr.ScVal[],
    kind: SorobanContractKind,
  ): Promise<{ txHash: string }> {
    const server = this.getServer();
    const signer = this.getSignerKeypair();
    const networkPassphrase = this.getNetworkPassphrase();

    let account;
    try {
      account = await server.getAccount(signer.publicKey());
    } catch (err) {
      throw this.wrapTransportError('Failed to load source account from Soroban RPC', err);
    }

    const operation = contract.call(method, ...args);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    let simulation;
    try {
      simulation = await server.simulateTransaction(tx);
    } catch (err) {
      throw this.wrapTransportError('Soroban simulateTransaction call failed', err);
    }

    if (rpc.Api.isSimulationError(simulation)) {
      throw this.mapSimulationError(simulation, kind);
    }

    let prepared: Transaction;
    try {
      prepared = await server.prepareTransaction(tx);
    } catch (err) {
      throw this.wrapTransportError('Soroban prepareTransaction call failed', err);
    }

    prepared.sign(signer);

    const toSubmit: Transaction | FeeBumpTransaction = this.sponsorKeypair
      ? this.wrapInFeeBump(prepared, networkPassphrase)
      : prepared;

    let sendResult;
    try {
      sendResult = await server.sendTransaction(toSubmit);
    } catch (err) {
      throw this.wrapTransportError('Soroban sendTransaction call failed', err);
    }

    if (sendResult.status === 'ERROR') {
      const diagnostic = this.describeDiagnostics(sendResult.diagnosticEvents);
      throw this.parseContractError(diagnostic || `Transaction rejected: ${sendResult.status}`, kind);
    }

    const finalStatus = await this.pollForResult(server, sendResult.hash, kind);
    return { txHash: finalStatus.txHash };
  }

  private async pollForResult(
    server: SorobanRpcClient,
    hash: string,
    kind: SorobanContractKind,
  ): Promise<{ txHash: string; value?: unknown }> {
    let result;
    try {
      result = await server.pollTransaction(hash, { attempts: SUBMIT_POLL_ATTEMPTS });
    } catch (err) {
      throw this.wrapTransportError('Soroban pollTransaction call failed', err);
    }

    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      const value = result.returnValue ? scValToNative(result.returnValue) : undefined;
      return { txHash: hash, value };
    }

    if (result.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
      throw new SorobanRpcError(
        `Soroban did not report a final status for transaction ${hash} within the polling window`,
      );
    }

    const diagnostic = this.describeDiagnostics(result.diagnosticEventsXdr);
    throw this.parseContractError(diagnostic || `Transaction ${hash} failed on-chain`, kind);
  }

  // ── Error decoding ──────────────────────────────────────────────────────

  private mapSimulationError(
    simulation: rpc.Api.SimulateTransactionErrorResponse,
    kind: SorobanContractKind,
  ): ContractError {
    const diagnostic = this.describeDiagnostics(simulation.events) || simulation.error;
    return this.parseContractError(diagnostic, kind);
  }

  /** Extracts the numeric `#[contracterror]` code from a `Error(Contract, #N)`-shaped diagnostic string. */
  private extractNumericErrorCode(raw: string): number | undefined {
    const match = raw.match(/Error\(Contract,\s*#(\d+)\)/);
    if (!match) return undefined;
    const code = Number(match[1]);
    return Number.isFinite(code) ? code : undefined;
  }

  /** Best-effort human-readable rendering of diagnostic events, for error-message matching. */
  private describeDiagnostics(events?: xdr.DiagnosticEvent[]): string {
    if (!events || events.length === 0) return '';
    const parts: string[] = [];
    for (const event of events) {
      try {
        const body = event.event().body().v0();
        const topics = body.topics().map((t) => this.safeScValToNative(t));
        const data = this.safeScValToNative(body.data());
        parts.push([...topics, data].filter((v) => v !== undefined).map(String).join(' '));
      } catch {
        // Malformed/unexpected event shape — skip it rather than fail the whole decode.
      }
    }
    return parts.join(' | ');
  }

  private safeScValToNative(val: xdr.ScVal): unknown {
    try {
      return scValToNative(val);
    } catch {
      return undefined;
    }
  }

  private wrapTransportError(message: string, cause: unknown): SorobanRpcError {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    this.logger.warn(`${message}: ${causeMessage}`);
    return new SorobanRpcError(`${message}: ${causeMessage}`, cause);
  }

  // ── Fee-bump sponsorship ────────────────────────────────────────────────

  /** Only called when `this.sponsorKeypair` is set — see the ternary at the call site. */
  private wrapInFeeBump(inner: Transaction, networkPassphrase: string): FeeBumpTransaction {
    const sponsor = this.sponsorKeypair!;
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(sponsor, BASE_FEE, inner, networkPassphrase);
    feeBump.sign(sponsor);
    return feeBump;
  }

  // ── Lazy config / client resolution ─────────────────────────────────────

  private getServer(): SorobanRpcClient {
    if (this.serverOverride) return this.serverOverride;
    if (!this.server) {
      this.server = new rpc.Server(this.getRpcUrlSync(), { allowHttp: this.getRpcUrlSync().startsWith('http://') });
    }
    return this.server;
  }

  private getSignerKeypair(): Keypair {
    if (!this.signerKeypair) {
      const loaded = loadSigningKey(this.config?.get<string>('SOROBAN_SIGNING_SECRET'));
      this.signerKeypair = loaded.keypair;
      if (loaded.ephemeral) {
        this.logger.warn(
          'SOROBAN_SIGNING_SECRET is not set — using an ephemeral signing key. ' +
            'Submitted transactions will be signed by a key that does not survive a restart. ' +
            'Configure a persistent key before production use.',
        );
      }
      const sponsorSecret = this.config?.get<string>('SOROBAN_SPONSOR_SECRET')?.trim();
      if (sponsorSecret) {
        this.sponsorKeypair = Keypair.fromSecret(sponsorSecret);
      }
    }
    return this.signerKeypair;
  }

  private getRpcUrlSync(): string {
    if (this.rpcUrl) return this.rpcUrl;
    this.rpcUrl =
      this.tryReadVaultStellar()?.rpc_url ??
      this.config?.get<string>('SOROBAN_RPC_URL') ??
      LOCAL_STANDALONE_RPC_URL;
    return this.rpcUrl;
  }

  private getNetworkPassphrase(): string {
    if (this.networkPassphrase) return this.networkPassphrase;
    this.networkPassphrase =
      this.tryReadVaultStellar()?.network_passphrase ??
      this.config?.get<string>('STELLAR_NETWORK_PASSPHRASE') ??
      (this.config?.get<string>('NODE_ENV') === 'production' ? Networks.PUBLIC : LOCAL_STANDALONE_PASSPHRASE);
    return this.networkPassphrase;
  }

  /** Vault secrets are only available once `VaultService` has completed bootstrap; treat as optional. */
  private tryReadVaultStellar(): { rpc_url: string; network_passphrase: string } | undefined {
    try {
      return this.vault?.stellar;
    } catch {
      return undefined;
    }
  }
}
