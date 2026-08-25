import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsNotEmpty } from 'class-validator';

export class FundInvoiceDto {
  @ApiProperty({
    description: 'Invoice ID to fund',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsNotEmpty()
  invoiceId: string;
}
