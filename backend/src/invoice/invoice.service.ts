import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class InvoiceService {
  constructor(private prisma: PrismaService) {}

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
