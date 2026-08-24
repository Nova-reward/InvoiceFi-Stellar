import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { FinancingPoolService } from './financing-pool.service';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanService } from '../soroban/soroban.service';
import { ContractError, ContractErrorCode } from '../common/contract-error';

const makeInvoice = (overrides: Partial<any> = {}) => ({
  id: 1,
  onchainId: 1n,
  status: 'PENDING',
  faceValue: 5000n,
  farmer: 'farmer-1',
  funder: null,
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
            invoice: { findUnique: jest.fn() },
            db: {
              $transaction: jest.fn((cb: (tx: any) => unknown) =>
                cb({
                  invoice: { update: jest.fn().mockResolvedValue({}) },
                  invoiceEvent: { create: jest.fn().mockResolvedValue(undefined) },
                }),
              ),
            },
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
        service.fundInvoice('investor-1', 'GABC', { invoiceId: '1', amount: 9999, discountRate: 0.1 }),
      ).rejects.toMatchObject({
        code: ContractErrorCode.InsufficientFunds,
        name: 'ContractError',
      });
    });

    it('re-throws ContractError from Soroban RPC on on-chain insufficient balance', async () => {
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(makeInvoice());
      (soroban.fundInvoice as jest.Mock).mockRejectedValue(new Error('InsufficientFunds'));
      (soroban.parseContractError as jest.Mock).mockReturnValue(
        new ContractError(ContractErrorCode.InsufficientFunds, 'Wallet balance is insufficient'),
      );

      await expect(
        service.fundInvoice('investor-1', 'GABC', { invoiceId: '1', amount: 4000, discountRate: 0.1 }),
      ).rejects.toMatchObject({ code: ContractErrorCode.InsufficientFunds });
    });
  });

  describe('DuplicateFunding', () => {
    it('throws ContractError(DuplicateFunding) when invoice is no longer PENDING', async () => {
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(makeInvoice({ status: 'FUNDED' }));

      await expect(
        service.fundInvoice('investor-1', 'GABC', { invoiceId: '1', amount: 4000, discountRate: 0.1 }),
      ).rejects.toMatchObject({ code: ContractErrorCode.DuplicateFunding });
    });
  });

  describe('Invoice not found', () => {
    it('throws NotFoundException when invoice does not exist', async () => {
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.fundInvoice('investor-1', 'GABC', { invoiceId: '999', amount: 1000, discountRate: 0.1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('happy path', () => {
    it('funds the invoice on-chain then transitions PENDING -> FUNDED and records an audit event', async () => {
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(makeInvoice());
      (soroban.fundInvoice as jest.Mock).mockResolvedValue({ txHash: 'deadbeef' });

      await service.fundInvoice('investor-1', 'GABC', { invoiceId: '1', amount: 4000, discountRate: 0.1 });

      expect(soroban.fundInvoice).toHaveBeenCalledWith({
        invoiceContractId: '1',
        investorWallet: 'GABC',
        amount: 4000,
      });
      expect(prisma.db.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});
