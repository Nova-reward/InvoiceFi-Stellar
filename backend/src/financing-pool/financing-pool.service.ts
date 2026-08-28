import { Injectable, Logger, NotFoundException, ConflictException, BadRequestException, ForbiddenException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanService } from '../soroban/soroban.service';
import { ContractError, ContractErrorCode } from '../common/contract-error';
import { appendInvoiceEvent } from '../invoices/invoice-event.service';
import { FundInvoiceDto } from './dto/funding.dto';
import { FallbackStrategyService } from '../oracle-monitor/fallback-strategy.service';
import { FundResponseDto } from './dto';

@Injectable()
export class FinancingPoolService {
  private readonly logger = new Logger(FinancingPoolService.name);

  constructor(
    private prisma: PrismaService,
    private soroban: SorobanService,
    @Optional() private fallbackStrategy?: FallbackStrategyService,
  ) {}

  /**
   * Fund an invoice with idempotency support and oracle fallback protection
   */
  async fundInvoice(
    userId: string,
    investorWallet: string,
    dto: FundInvoiceDto,
  ): Promise<FundResponseDto> {
    // Guard: halt mode blocks all new fundings
    if (this.fallbackStrategy?.shouldBlockFunding()) {
      this.logger.warn(
        `Funding blocked: oracle fallback halt mode active (investor=${userId}, invoice=${dto.invoiceId})`,
      );
      throw new ServiceUnavailableException(
        'New fundings are temporarily halted due to oracle data staleness. Please retry after oracle feeds recover.',
      );
    }

    // 1. Find the invoice
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: Number(dto.invoiceId) },
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice ${dto.invoiceId} not found`);
    }

    // 2. Check if already funded (using status)
    if (invoice.status !== InvoiceStatus.PENDING) {
      throw new ContractError(ContractErrorCode.DuplicateFunding, 'Invoice has already been funded');
    }

    // 3. Check if user is authorized (must be the buyer)
    if (invoice.buyerId !== userId) {
      throw new ForbiddenException('Only the buyer can fund this invoice');
    }

    // 4. Check if invoice is in correct state
    if (invoice.status !== 'verified' && invoice.status !== InvoiceStatus.PENDING) {
      throw new BadRequestException('Invoice must be verified before funding');
    }

    // 5. Validate funding amount
    if (BigInt(dto.amount) > invoice.faceValue) {
      throw new ContractError(ContractErrorCode.InsufficientFunds, 'Funding amount exceeds invoice value');
    }

    // 6. Apply fallback risk premium if in last_known_good mode
    let effectiveDiscountRate = dto.discountRate;
    if (this.fallbackStrategy?.getActiveMode() === 'last_known_good') {
      const premiumBps = this.fallbackStrategy.getRiskPremiumBps();
      effectiveDiscountRate = this.fallbackStrategy.calculateEffectiveDiscountBps(dto.discountRate);
      this.logger.log(
        `Applying fallback risk premium: +${premiumBps}bps (discount ${dto.discountRate} -> ${effectiveDiscountRate}) for invoice ${dto.invoiceId}`,
      );
    }

    // 7. Execute Soroban contract call
    let txHash: string | undefined;
    try {
      const result = await this.soroban.fundInvoice({
        invoiceContractId: invoice.onchainId.toString(),
        investorWallet,
        amount: dto.amount,
      });
      txHash = result.txHash;
    } catch (error) {
      this.logger.error(
        `Failed to fund invoice ${dto.invoiceId}: ${error.message}`
      );
      
      // Parse contract error
      if (error.message?.includes('revert')) {
        throw new BadRequestException(
          `Contract reverted: ${error.message}`
        );
      }
      
      throw this.soroban.parseContractError((error as Error).message);
    }

    // 8. Update invoice in database (within transaction)
    let updatedInvoice;
    try {
      const funding = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            status: InvoiceStatus.FUNDED,
            funder: investorWallet,
            fundedAmount: BigInt(dto.amount),
            discountPercentage: effectiveDiscountRate,
            fundedAt: new Date(),
            fundedTxHash: txHash,
          },
        });

        await appendInvoiceEvent(tx, {
          invoiceOnchainId: invoice.onchainId,
          previousStatus: InvoiceStatus.PENDING,
          newStatus: InvoiceStatus.FUNDED,
          actorId: userId,
          txHash,
        });

        return updated;
      });

      updatedInvoice = funding;
    } catch (error) {
      this.logger.error(
        `Failed to update invoice ${dto.invoiceId} in database: ${error.message}`
      );
      throw error;
    }

    this.logger.log(
      `Invoice ${dto.invoiceId} funded by user ${userId} with tx ${txHash}`
    );

    return {
      success: true,
      invoiceId: updatedInvoice.id.toString(),
      txHash: txHash || 'unknown',
      message: 'Invoice funded successfully',
      fundedAt: updatedInvoice.fundedAt || new Date(),
    };
  }
}