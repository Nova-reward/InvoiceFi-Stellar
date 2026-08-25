import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsString, IsDateString, IsOptional, IsPositive, IsEnum } from 'class-validator';

export class CreateInvoiceDto {
  @ApiProperty({ example: 5000, description: 'Invoice amount' })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiPropertyOptional({ example: 'USDC', enum: ['USDC', 'XLM', 'AQUA'] })
  @IsEnum(['USDC', 'XLM', 'AQUA'])
  @IsOptional()
  currency?: string;

  @ApiProperty({ example: '2026-12-31T00:00:00Z', description: 'Invoice expiry timestamp' })
  @IsDateString()
  expiresAt: string;

  @ApiPropertyOptional({ description: 'Soroban contract ID for on-chain invoice' })
  @IsString()
  @IsOptional()
  contractId?: string;
}

export class InvoiceResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() ownerId: string;
  @ApiProperty() amount: number;
  @ApiProperty() currency: string;
  @ApiProperty() expiresAt: string;
  @ApiProperty({ enum: ['PENDING', 'FUNDED', 'SETTLED', 'EXPIRED'] }) status: string;
  @ApiPropertyOptional() contractId?: string;
  @ApiProperty() createdAt: string;
}
