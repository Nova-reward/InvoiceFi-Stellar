import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { InvoiceDto, InvoicesService } from './invoices.service';

@Controller()
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get('invoices')
  findAll(): Promise<InvoiceDto[]> {
    return this.invoices.findAll();
  }

  @Get('invoices/:onchainId')
  async findOne(@Param('onchainId') onchainId: string): Promise<InvoiceDto> {
    const invoice = await this.invoices.findOne(onchainId);
    if (!invoice) {
      throw new NotFoundException(`Invoice ${onchainId} not found`);
    }
    return invoice;
  }

  @Get('dashboard/farmer/:address')
  farmerDashboard(@Param('address') address: string): Promise<InvoiceDto[]> {
    return this.invoices.byFarmer(address);
  }

  @Get('dashboard/investor/:address')
  investorDashboard(@Param('address') address: string): Promise<InvoiceDto[]> {
    return this.invoices.byInvestor(address);
  }
}
