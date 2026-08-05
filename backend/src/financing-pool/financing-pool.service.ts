import { Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanService } from '../soroban/soroban.service';
import { ContractError, ContractErrorCode } from '../common/contract-error';
import { FundInvoiceDto } from './dto/funding.dto';
import { FallbackStrategyService } from '../oracle-monitor/fallback-strategy.service';

@Injectable()
export class FinancingPoolService {
  private readonly logger = new Logger(FinancingPoolService.name);

  constructor(
    private prisma: PrismaService,
    private soroban: SorobanService,
    @Optional() private fallbackStrategy?: FallbackStrategyService,
  ) {}

  async fundInvoice(investorId: string, investorWallet: string, dto: FundInvoiceDto) {
    // Guard: halt mode blocks all new fundings
    if (this.fallbackStrategy?.shouldBlockFunding()) {
      this.logger.warn(
        `Funding blocked: oracle fallback halt mode active (investor=${investorId}, invoice=${dto.invoiceId})`,
      );
      throw new ServiceUnavailableException(
        'New fundings are temporarily halted due to oracle data staleness. Please retry after oracle feeds recover.',
      );
    }

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

    // Apply fallback risk premium if in last_known_good mode
    let effectiveDiscountRate = dto.discountRate;
    if (this.fallbackStrategy?.getActiveMode() === 'last_known_good') {
      const premiumBps = this.fallbackStrategy.getRiskPremiumBps();
      effectiveDiscountRate = this.fallbackStrategy.calculateEffectiveDiscountBps(dto.discountRate);
      this.logger.log(
        `Applying fallback risk premium: +${premiumBps}bps (discount ${dto.discountRate} -> ${effectiveDiscountRate}) for invoice ${dto.invoiceId}`,
      );
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
          discountRate: effectiveDiscountRate,
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
