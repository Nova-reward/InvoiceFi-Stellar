import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanService } from '../soroban/soroban.service';
import { ContractError, ContractErrorCode } from '../common/contract-error';
import { FundInvoiceDto } from './dto/funding.dto';

@Injectable()
export class FinancingPoolService {
  constructor(private prisma: PrismaService, private soroban: SorobanService) {}

  async fundInvoice(investorId: string, investorWallet: string, dto: FundInvoiceDto) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: dto.invoiceId },
      include: { funding: true },
    });

    if (!invoice) throw new NotFoundException(`Invoice ${dto.invoiceId} not found`);

    // Guard: already funded
    if (invoice.funding) {
      throw new ContractError(ContractErrorCode.DuplicateFunding, 'Invoice has already been funded');
    }

    // Guard: expired
    if (new Date() > invoice.expiresAt) {
      throw new ContractError(ContractErrorCode.InvoiceExpired, 'Invoice has passed its expiry timestamp');
    }

    // Guard: insufficient funds (caller must pass their balance for verification)
    if (dto.amount > invoice.amount) {
      throw new ContractError(ContractErrorCode.InsufficientFunds, 'Funding amount exceeds invoice value');
    }

    // Invoke on-chain contract when contractId is present
    if (invoice.contractId) {
      try {
        await this.soroban.fundInvoice({
          invoiceContractId: invoice.contractId,
          investorWallet,
          amount: dto.amount,
        });
      } catch (err) {
        throw this.soroban.parseContractError((err as Error).message);
      }
    }

    const [funding] = await this.prisma.$transaction([
      this.prisma.funding.create({
        data: {
          invoiceId: invoice.id,
          investorId,
          amount: dto.amount,
          discountRate: dto.discountRate,
        },
      }),
      this.prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'FUNDED' },
      }),
    ]);

    return funding;
  }
}
