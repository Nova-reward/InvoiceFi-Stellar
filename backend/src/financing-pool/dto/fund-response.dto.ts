import { ApiProperty } from '@nestjs/swagger';

export class FundResponseDto {
  @ApiProperty({ description: 'Whether the operation was successful' })
  success: boolean;

  @ApiProperty({ description: 'The invoice ID' })
  invoiceId: string;

  @ApiProperty({ description: 'Transaction hash' })
  txHash: string;

  @ApiProperty({ description: 'Status message' })
  message: string;

  @ApiProperty({ description: 'When the invoice was funded' })
  fundedAt: Date;
}
