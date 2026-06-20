import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanService } from '../soroban/soroban.service';
import { ContractError, ContractErrorCode } from '../common/contract-error';
import { SettleInvoiceDto } from './dto/settlement.dto';

@Injectable()
export class SettlementService {
  constructor(private prisma: PrismaService, private soroban: SorobanService) {}

  async settle(callerId: string, callerWallet: string, dto: SettleInvoiceDto) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: dto.invoiceId },
      include: { funding: true },
    });

    if (!invoice) throw new NotFoundException(`Invoice ${dto.invoiceId} not found`);

    // Guard: already settled
    if (invoice.status === 'SETTLED') {
      throw new ContractError(ContractErrorCode.InvalidState, 'Invoice has already been settled');
    }

    // Guard: not funded yet
    if (invoice.status !== 'FUNDED' || !invoice.funding) {
      throw new ContractError(ContractErrorCode.InvalidState, 'Invoice must be in FUNDED state before settlement');
    }

    // Guard: only owner can settle
    if (invoice.ownerId !== callerId) {
      throw new ContractError(ContractErrorCode.Unauthorized, 'Only the invoice owner can trigger settlement');
    }

    // Invoke on-chain contract when contractId is present
    if (invoice.contractId) {
      try {
        await this.soroban.settleInvoice({ invoiceContractId: invoice.contractId, callerWallet });
      } catch (err) {
        throw this.soroban.parseContractError((err as Error).message);
      }
    }

    const [funding] = await this.prisma.$transaction([
      this.prisma.funding.update({
        where: { id: invoice.funding.id },
        data: { status: 'SETTLED', settledAt: new Date() },
      }),
      this.prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'SETTLED' },
      }),
    ]);

    return funding;
  }
}
