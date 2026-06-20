import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SettlementService } from './settlement.service';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanService } from '../soroban/soroban.service';
import { ContractError, ContractErrorCode } from '../common/contract-error';

const makeFunding = () => ({ id: 'fund-1', invoiceId: 'inv-1', investorId: 'investor-1', amount: 4500 });

const makeInvoice = (overrides: Partial<any> = {}) => ({
  id: 'inv-1',
  ownerId: 'user-1',
  amount: 5000,
  status: 'FUNDED',
  contractId: null,
  funding: makeFunding(),
  ...overrides,
});

describe('SettlementService – contract failure scenarios', () => {
  let service: SettlementService;
  let prisma: jest.Mocked<PrismaService>;
  let soroban: jest.Mocked<SorobanService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettlementService,
        {
          provide: PrismaService,
          useValue: {
            invoice: { findUnique: jest.fn(), update: jest.fn() },
            funding: { update: jest.fn() },
            $transaction: jest.fn(),
          },
        },
        {
          provide: SorobanService,
          useValue: {
            settleInvoice: jest.fn(),
            parseContractError: jest.fn((msg: string) => new ContractError(ContractErrorCode.Unauthorized, msg)),
          },
        },
      ],
    }).compile();

    service = module.get(SettlementService);
    prisma = module.get(PrismaService) as jest.Mocked<PrismaService>;
    soroban = module.get(SorobanService) as jest.Mocked<SorobanService>;
  });

  describe('InvalidState – already settled', () => {
    it('throws ContractError(InvalidState) when invoice status is SETTLED', async () => {
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(
        makeInvoice({ status: 'SETTLED', funding: makeFunding() }),
      );

      await expect(
        service.settle('user-1', 'GABC', { invoiceId: 'inv-1' }),
      ).rejects.toMatchObject({ code: ContractErrorCode.InvalidState });
    });
  });

  describe('InvalidState – not funded', () => {
    it('throws ContractError(InvalidState) when invoice is PENDING (not funded)', async () => {
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(
        makeInvoice({ status: 'PENDING', funding: null }),
      );

      await expect(
        service.settle('user-1', 'GABC', { invoiceId: 'inv-1' }),
      ).rejects.toMatchObject({ code: ContractErrorCode.InvalidState });
    });
  });

  describe('Unauthorized settlement', () => {
    it('throws ContractError(Unauthorized) when caller is not the invoice owner', async () => {
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(makeInvoice({ ownerId: 'user-1' }));

      await expect(
        service.settle('different-user', 'GXYZ', { invoiceId: 'inv-1' }),
      ).rejects.toMatchObject({ code: ContractErrorCode.Unauthorized });
    });

    it('re-throws Unauthorized ContractError from Soroban RPC', async () => {
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(
        makeInvoice({ ownerId: 'user-1', contractId: 'CONTRACT-ABC' }),
      );
      (soroban.settleInvoice as jest.Mock).mockRejectedValue(new Error('Unauthorized'));
      (soroban.parseContractError as jest.Mock).mockReturnValue(
        new ContractError(ContractErrorCode.Unauthorized, 'Caller is not authorized'),
      );

      await expect(
        service.settle('user-1', 'GABC', { invoiceId: 'inv-1' }),
      ).rejects.toMatchObject({ code: ContractErrorCode.Unauthorized });
    });
  });

  describe('Invoice not found', () => {
    it('throws NotFoundException when invoice does not exist', async () => {
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.settle('user-1', 'GABC', { invoiceId: 'missing' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
