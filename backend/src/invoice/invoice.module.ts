import { Module } from '@nestjs/common';
import { InvoiceService } from './invoice.service';
<<<<<<< feat/contract-failure-tests-and-swagger
import { InvoiceController } from './invoice.controller';

@Module({
  providers: [InvoiceService],
  controllers: [InvoiceController],
=======

@Module({
  providers: [InvoiceService],
>>>>>>> main
  exports: [InvoiceService],
})
export class InvoiceModule {}
