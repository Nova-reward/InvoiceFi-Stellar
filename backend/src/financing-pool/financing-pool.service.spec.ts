import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { FinancingPoolService } from './financing-pool.service';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanService } from '../soroban/soroban.service';
import { ContractError, ContractErrorCode } from '../common/contract-error';

const FUTURE = new Date(Date.now() + 86_400_000);
const PAST = new Date(Date.now() - 86_400_000);

const makeInvoice = (overrides: Partial<any> = {}) => ({
  id: 'inv-1',
  ownerId: 'user-1',
  amount: 5000,
  currency: 'USDC',
  expiresAt: FUTURE,
  status: 'PENDING',
  contractId: null,
  funding: null,
  ...overrides,
});

describe('FinancingPoolService – contract failure scenarios', () => {
  let service: FinancingPoolService;
  let prisma: jest.Mocked<PrismaService>;
  let soroban: jest.Mocked<SorobanService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinancingPoolService,
        {
          provide: PrismaService,
          useValue: {
            invoice: { findUnique: jest.fn(), update: jest.fn() },
            funding: { create: jest.fn() },
            $transaction: jest.fn(),
          },
        },
        {
          provide: SorobanService,
          useValue: {
            fundInvoice: jest.fn(),
            parseContractError: jest.fn((msg: string) => new ContractError(ContractErrorCode.InsufficientFunds, msg)),
          },
        },
      ],
    }).compile();

    service = module.get(FinancingPoolService);
    prisma = module.get(PrismaService) as jest.Mocked<PrismaService>;
    soroban = module.get(SorobanService) as jest.Mocked<SorobanService>;
  });

  describe('InsufficientFunds', () => {
    it('throws ContractError(InsufficientFunds) when funding amount exceeds invoice value', async () => {
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(makeInvoice());

      await expect(
        service.fundInvoice('investor-1', 'GABC', { invoiceId: 'inv-1', amount: 9999, discountRate: 0.1 }),
      ).rejects.toMatchObject({
        code: ContractErrorCode.InsufficientFunds,
        name: 'ContractError',
      });
    });

    it('re-throws ContractError from Soroban RPC on on-chain insufficient balance', async () => {
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(
        makeInvoice({ contractId: 'CONTRACT-ABC' }),
      );
      (soroban.fundInvoice as jest.Mock).mockRejectedValue(new Error('InsufficientFunds'));
      (soroban.parseContractError as jest.Mock).mockReturnValue(
        new ContractError(ContractErrorCode.InsufficientFunds, 'Wallet balance is insufficient'),
      );

      await expect(
        service.fundInvoice('investor-1', 'GABC', { invoiceId: 'inv-1', amount: 4000, discountRate: 0.1 }),
      ).rejects.toMatchObject({ code: ContractErrorCode.InsufficientFunds });
    });
  });

  describe('InvoiceExpired', () => {
    it('throws ContractError(InvoiceExpired) when invoice expiry has passed', async () => {
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(makeInvoice({ expiresAt: PAST }));

      await expect(
        service.fundInvoice('investor-1', 'GABC', { invoiceId: 'inv-1', amount: 4000, discountRate: 0.1 }),
      ).rejects.toMatchObject({ code: ContractErrorCode.InvoiceExpired });
    });
  });

  describe('DuplicateFunding', () => {
    it('throws ContractError(DuplicateFunding) when invoice already has funding', async () => {
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(
        makeInvoice({
          status: 'FUNDED',
          funding: { id: 'fund-1', invoiceId: 'inv-1', investorId: 'investor-0', amount: 5000 },
        }),
      );

      await expect(
        service.fundInvoice('investor-1', 'GABC', { invoiceId: 'inv-1', amount: 4000, discountRate: 0.1 }),
      ).rejects.toMatchObject({ code: ContractErrorCode.DuplicateFunding });
    });
  });

  describe('Invoice not found', () => {
    it('throws NotFoundException when invoice does not exist', async () => {
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.fundInvoice('investor-1', 'GABC', { invoiceId: 'missing', amount: 1000, discountRate: 0.1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
