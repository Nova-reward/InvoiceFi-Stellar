import { Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanService } from '../soroban/soroban.service';
import { ContractError, ContractErrorCode } from '../common/contract-error';
import { appendInvoiceEvent } from '../invoices/invoice-event.service';
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
      where: { id: Number(dto.invoiceId) },
    });

    if (!invoice) throw new NotFoundException(`Invoice ${dto.invoiceId} not found`);

    // Guard: already funded (or otherwise past PENDING)
    if (invoice.status !== InvoiceStatus.PENDING) {
      throw new ContractError(ContractErrorCode.DuplicateFunding, 'Invoice has already been funded');
    }

    // Guard: insufficient funds (caller must pass their balance for verification)
    // faceValue is a BigInt column; dto.amount is a plain number from the request body.
    if (BigInt(dto.amount) > invoice.faceValue) {
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

    // Invoke the on-chain contract. Every Invoice row has an onchainId (it is
    // the join key the settlement listener depends on), so unlike the old
    // `if (invoice.contractId)` guard, this always runs.
    let txHash: string | undefined;
    try {
      const result = await this.soroban.fundInvoice({
        invoiceContractId: invoice.onchainId.toString(),
        investorWallet,
        amount: dto.amount,
      });
      txHash = result.txHash;
    } catch (err) {
      throw this.soroban.parseContractError((err as Error).message);
    }

    const funding = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: InvoiceStatus.FUNDED,
          funder: investorWallet,
          fundedAmount: BigInt(dto.amount),
          discountPercentage: effectiveDiscountRate,
        },
      });

      await appendInvoiceEvent(tx, {
        invoiceOnchainId: invoice.onchainId,
        previousStatus: InvoiceStatus.PENDING,
        newStatus: InvoiceStatus.FUNDED,
        actorId: investorId,
        txHash,
      });

      return updated;
    });

    return funding;
  }
}
