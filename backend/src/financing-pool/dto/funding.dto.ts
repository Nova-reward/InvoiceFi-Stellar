import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsPositive, IsOptional } from 'class-validator';

export class FundInvoiceDto {
  @ApiProperty({ description: 'Invoice ID to fund' })
  @IsString()
  invoiceId: string;

  @ApiProperty({ example: 4500, description: 'Funding amount (must be ≤ invoice amount)' })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({ example: 0.1, description: 'Discount rate (0–1)' })
  @IsNumber()
  discountRate: number;
}

export class FundingResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() invoiceId: string;
  @ApiProperty() investorId: string;
  @ApiProperty() amount: number;
  @ApiProperty() discountRate: number;
  @ApiProperty({ enum: ['ACTIVE', 'SETTLED'] }) status: string;
  @ApiProperty() fundedAt: string;
  @ApiProperty({ required: false }) settledAt?: string;
}

export class ContractErrorDto {
  @ApiProperty({ example: 'InsufficientFunds' })
  error: string;
  @ApiProperty({ example: 'Wallet balance is insufficient to fund this invoice' })
  message: string;
  @ApiProperty({ example: 422 })
  statusCode: number;
}
