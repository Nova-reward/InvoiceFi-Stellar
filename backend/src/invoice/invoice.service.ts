import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/invoice.dto';

@Injectable()
export class InvoiceService {
  constructor(private prisma: PrismaService) {}

  create(userId: string, dto: CreateInvoiceDto) {
    return this.prisma.invoice.create({
      data: {
        onchainId: BigInt(dto.contractId ? dto.contractId.length : Date.now()),
        faceValue: BigInt(dto.amount),
        farmer: userId,
        investor: null,
      },
    });
  }

  findAll(userId: string) {
    return this.prisma.invoice.findMany({
      where: {
        OR: [{ farmer: userId }, { investor: userId }],
      },
    });
  }

  async findOne(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: Number(id) },
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }

    return invoice;
  }

  async findInvoicesDueSoon(hours: number = 72) {
    const dueDate = new Date();
    dueDate.setHours(dueDate.getHours() + hours);

    return this.prisma.invoice.findMany({
      where: {
        status: 'FUNDED',
        createdAt: {
          lte: dueDate,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async findById(id: string) {
    return this.prisma.invoice.findUnique({
      where: { id: Number(id) },
    });
  }
}
