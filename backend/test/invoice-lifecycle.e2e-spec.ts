import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import request from 'supertest';
import { InvoiceStatus } from '@prisma/client';
import { InvoicesModule } from '../src/invoices/invoices.module';
import { SettlementModule } from '../src/settlement/settlement.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { VaultModule } from '../src/config/vault/vault.module';
import { VaultService } from '../src/config/vault/vault.service';
import { SettlementService } from '../src/settlement/settlement.service';
import { appendInvoiceEvent } from '../src/invoices/invoice-event.service';

/**
 * Exercises the invoice_events audit trail (issue #162) against the real,
 * wired application modules — PrismaModule, SettlementModule, InvoicesModule
 * — the same providers AppModule assembles for `prisma`/`settlement`/
 * `invoices`. It intentionally does NOT boot the full AppModule: several
 * other feature modules (compliance, oracle-monitor, webhooks' HTTP surface,
 * monitoring) are unrelated to this ticket and would only add unrelated
 * failure modes. `financing-pool` is excluded on purpose — see below.
 *
 * Requires a reachable Postgres (`docker compose up -d postgres`, matching
 * this repo's docker-compose defaults) via DATABASE_URL/POSTGRES_* env vars.
 * VaultService is stubbed here (it only fetches DB credentials — a pure
 * infra concern) rather than requiring a live Vault server; everything else
 * under test is real, wired application code.
 */

class StubVaultService {
  async onApplicationBootstrap(): Promise<void> {}
  get database() {
    return {
      username: process.env.POSTGRES_USER ?? 'invoicefi',
      password: process.env.POSTGRES_PASSWORD ?? 'invoicefi_secret',
      database: process.env.POSTGRES_DB ?? 'invoicefi',
      host: process.env.POSTGRES_HOST ?? 'localhost',
      port: process.env.POSTGRES_PORT ?? '5432',
    };
  }
}

describe('Invoice event audit trail (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let settlement: SettlementService;
  let onchainId: bigint;

  beforeAll(async () => {
    // Keep SettlementSyncService's background poll loop out of the way —
    // this test drives settleInvoice() directly rather than through polling.
    process.env.SETTLEMENT_POLL_INTERVAL_MS = '3600000';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        ScheduleModule.forRoot(),
        VaultModule,
        PrismaModule,
        SettlementModule,
        InvoicesModule,
      ],
    })
      .overrideProvider(VaultService)
      .useClass(StubVaultService)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    settlement = app.get(SettlementService);
  });

  afterAll(async () => {
    // Deliberately no cleanup delete here: invoice_events is append-only, and
    // the acceptance criteria for issue #162 require no DELETE statements
    // against it anywhere in the codebase, tests included. `onchainId` is
    // derived from Date.now(), so the seeded row is unique per run and left
    // behind harmlessly rather than deleted.
    if (app) await app.close();
  });

  it('records the full Pending -> Funded -> Settled chain and serves it via GET /invoices/:id/events', async () => {
    onchainId = BigInt(Date.now()); // unique per run

    // 1. Invoice created (PENDING) — mirrors invoice ingestion, out of this
    //    ticket's scope; seeded directly.
    const invoice = await prisma.db.invoice.create({
      data: {
        onchainId,
        status: InvoiceStatus.PENDING,
        faceValue: 5000n,
        farmer: 'GFARMER_TEST',
      },
    });

    // 2. PENDING -> FUNDED. `FinancingPoolService` owns this transition, but
    //    it lives under `backend/src/financing-pool`, which is excluded from
    //    the build (see docs/EXCLUDED_MODULES.md: it targets a richer schema
    //    and depends on class-validator/@nestjs/swagger, neither installed).
    //    That file has still been updated to call `appendInvoiceEvent` the
    //    same way this test does, so re-enabling it (per that doc's steps)
    //    gets the audit trail for free. Here, call the same real, non-excluded
    //    `appendInvoiceEvent` helper directly to stand in for that step.
    await prisma.db.$transaction(async (tx) => {
      await tx.invoice.update({
        where: { onchainId },
        data: { status: InvoiceStatus.FUNDED, funder: 'GINVESTOR_TEST', fundedAmount: 4500n },
      });
      await appendInvoiceEvent(tx, {
        invoiceOnchainId: onchainId,
        previousStatus: InvoiceStatus.PENDING,
        newStatus: InvoiceStatus.FUNDED,
        actorId: 'investor-test',
        txHash: 'fund-tx-hash',
      });
    });

    // 3. FUNDED -> REPAID via the real, wired SettlementService — the actual
    //    target of this ticket's settlement-sync wiring.
    await settlement.settleInvoice(onchainId.toString(), 999, 'settle-tx-hash');

    // 4. Full history via the real HTTP endpoint.
    const res = await request(app.getHttpServer())
      .get(`/invoices/${onchainId}/events`)
      .expect(200);

    expect(res.body).toHaveLength(2);

    const [funded, settled] = res.body;
    expect(funded).toMatchObject({
      previousStatus: 'PENDING',
      newStatus: 'FUNDED',
      actorId: 'investor-test',
      txHash: 'fund-tx-hash',
    });
    expect(settled).toMatchObject({
      previousStatus: 'FUNDED',
      newStatus: 'REPAID',
      actorId: 'settlement-sync-service',
      txHash: 'settle-tx-hash',
    });
    // Ordered oldest -> newest.
    expect(BigInt(funded.occurredAtNanos) <= BigInt(settled.occurredAtNanos)).toBe(true);

    const finalInvoice = await prisma.db.invoice.findUniqueOrThrow({ where: { onchainId } });
    expect(finalInvoice.status).toBe(InvoiceStatus.REPAID);
  });
});

/**
 * Integration coverage for the Pending -> Funded -> Settled chain's Soroban
 * leg, exercised through the real `SorobanService` wired via Nest DI (not
 * the app's HTTP surface — the `MockAppModule` above has no routes wired to
 * `FinancingPoolModule`/`SettlementModule`, so it can't drive this). Instead
 * this stubs the Soroban RPC boundary (`SorobanRpcClient`) directly, the
 * same seam `soroban.service.spec.ts` uses for its unit tests, and asserts
 * `SorobanService` produces correctly-signed, XDR-encoded transactions and a
 * real transaction hash end-to-end through Nest's module system.
 */
describe('Invoice Lifecycle Integration (e2e) — Soroban RPC leg', () => {
  let moduleRef: TestingModule;
  let soroban: SorobanService;
  let stubServer: jest.Mocked<SorobanRpcClient>;

  const investor = Keypair.random().publicKey();
  const invoiceContractId = StrKey.encodeContract(Buffer.alloc(32, 7));

  beforeAll(async () => {
    stubServer = {
      getAccount: jest.fn().mockResolvedValue(new Account(Keypair.random().publicKey(), '1')),
      simulateTransaction: jest.fn().mockResolvedValue({
        id: '1',
        latestLedger: 100,
        events: [],
        _parsed: true,
        transactionData: {} as any,
        minResourceFee: '100',
        result: { auth: [], retval: nativeToScVal(true, { type: 'bool' }) },
      }),
      prepareTransaction: jest.fn().mockImplementation(async (tx) => tx),
      sendTransaction: jest.fn().mockImplementation(async () => ({
        status: 'PENDING',
        hash: 'e'.repeat(64),
        latestLedger: 100,
        latestLedgerCloseTime: 0,
      })),
      pollTransaction: jest.fn().mockImplementation(async () => ({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
        txHash: 'e'.repeat(64),
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
      })),
    } as unknown as jest.Mocked<SorobanRpcClient>;

    moduleRef = await Test.createTestingModule({
      providers: [SorobanService],
    })
      .overrideProvider(SorobanService)
      .useFactory({ factory: () => new SorobanService(undefined, undefined, stubServer) })
      .compile();

    soroban = moduleRef.get(SorobanService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('funds an invoice through a stubbed Soroban RPC and records the real tx hash', async () => {
    const result = await soroban.fundInvoice({
      invoiceContractId,
      investorWallet: investor,
      amount: 5000,
    });

    expect(result.txHash).toBe('e'.repeat(64));
    expect(stubServer.simulateTransaction).toHaveBeenCalledTimes(1);
    expect(stubServer.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('settles the same invoice through a stubbed Soroban RPC and records the real tx hash', async () => {
    const result = await soroban.settleInvoice({
      invoiceContractId,
      callerWallet: investor,
    });

    expect(result.txHash).toBe('e'.repeat(64));
  });

  it('maps a simulated contract panic to the typed ContractError instead of a raw RPC error', async () => {
    stubServer.simulateTransaction.mockResolvedValueOnce({
      id: '2',
      latestLedger: 100,
      events: [],
      _parsed: true,
      error: 'HostError: Error(Contract, #7)', // FinancingPoolError::AlreadyFunded
    } as any);

    await expect(
      soroban.fundInvoice({ invoiceContractId, investorWallet: investor, amount: 5000 }),
    ).rejects.toMatchObject({ name: 'ContractError', code: 'DuplicateFunding' });
  });
});
