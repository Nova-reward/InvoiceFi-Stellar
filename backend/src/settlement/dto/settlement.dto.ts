import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class SettleInvoiceDto {
  @ApiProperty({ description: 'Invoice ID to settle' })
  @IsString()
  invoiceId: string;
}

export class SettlementResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() invoiceId: string;
  @ApiProperty({ enum: ['ACTIVE', 'SETTLED'] }) status: string;
  @ApiProperty() settledAt: string;
}
