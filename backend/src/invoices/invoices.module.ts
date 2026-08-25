import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { InvoiceEventService } from './invoice-event.service';

@Module({
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoiceEventService],
  exports: [InvoicesService, InvoiceEventService],
})
export class InvoicesModule {}
