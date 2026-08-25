import { Injectable, NotFoundException } from '@nestjs/common';
import { Invoice } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceEventDto, InvoiceEventService } from './invoice-event.service';

/** API representation of an invoice with BigInt fields rendered as strings. */
export interface InvoiceDto {
  id: number;
  onchainId: string;
  status: string;
  faceValue: string;
  farmer: string;
  investor: string | null;
  settledLedger: number | null;
  settledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toDto(invoice: Invoice): InvoiceDto {
  return {
    id: invoice.id,
    onchainId: invoice.onchainId.toString(),
    status: invoice.status,
    faceValue: invoice.faceValue.toString(),
    farmer: invoice.farmer,
    investor: invoice.investor,
    settledLedger: invoice.settledLedger,
    settledAt: invoice.settledAt?.toISOString() ?? null,
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
  };
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoiceEvents: InvoiceEventService,
  ) {}

  async findAll(): Promise<InvoiceDto[]> {
    const invoices = await this.prisma.invoice.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return invoices.map(toDto);
  }

  async findOne(onchainId: string): Promise<InvoiceDto | null> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { onchainId: BigInt(onchainId) },
    });
    return invoice ? toDto(invoice) : null;
  }

  async byFarmer(farmer: string): Promise<InvoiceDto[]> {
    const invoices = await this.prisma.invoice.findMany({
      where: { farmer },
      orderBy: { createdAt: 'desc' },
    });
    return invoices.map(toDto);
  }

  async byInvestor(investor: string): Promise<InvoiceDto[]> {
    const invoices = await this.prisma.invoice.findMany({
      where: { investor },
      orderBy: { createdAt: 'desc' },
    });
    return invoices.map(toDto);
  }

  /** Full append-only event history for an invoice, ordered oldest first. */
  async events(onchainId: string): Promise<InvoiceEventDto[]> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { onchainId: BigInt(onchainId) },
    });
    if (!invoice) {
      throw new NotFoundException(`Invoice ${onchainId} not found`);
    }
    return this.invoiceEvents.listByOnchainId(invoice.onchainId);
  }
}
