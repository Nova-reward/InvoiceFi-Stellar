<<<<<<< feat/contract-failure-tests-and-swagger
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/invoice.dto';
=======
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
>>>>>>> main

@Injectable()
export class InvoiceService {
  constructor(private prisma: PrismaService) {}

<<<<<<< feat/contract-failure-tests-and-swagger
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
=======
  async findInvoicesDueSoon(hours: number = 72) {
    const dueDate = new Date();
    dueDate.setHours(dueDate.getHours() + hours);

    return this.prisma.invoice.findMany({
      where: {
        status: 'FUNDED',
        dueDate: {
          lte: dueDate,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });
  }

  async findById(id: string) {
    return this.prisma.invoice.findUnique({
      where: { id },
      include: {
        user: true,
      },
    });
>>>>>>> main
  }
}
