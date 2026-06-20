import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/invoice.dto';

@Injectable()
export class InvoiceService {
  constructor(private prisma: PrismaService) {}

  create(userId: string, dto: CreateInvoiceDto) {
    return this.prisma.invoice.create({
      data: {
        ownerId: userId,
        amount: dto.amount,
        currency: dto.currency ?? 'USDC',
        expiresAt: new Date(dto.expiresAt),
        contractId: dto.contractId,
      },
    });
  }

  findAll(userId: string) {
    return this.prisma.invoice.findMany({ where: { ownerId: userId }, include: { funding: true } });
  }

  async findOne(id: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id }, include: { funding: true } });
    if (!invoice) throw new NotFoundException(`Invoice ${id} not found`);
    return invoice;
  }
}
