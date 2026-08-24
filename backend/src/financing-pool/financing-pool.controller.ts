import { Controller, Post, Body, UseInterceptors, UseGuards, Request, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader, ApiBearerAuth } from '@nestjs/swagger';
import { FinancingPoolService } from './financing-pool.service';
import { FundInvoiceDto, FundResponseDto } from './dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';

@ApiTags('financing-pool')
@Controller('financing-pool')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class FinancingPoolController {
  constructor(private readonly financingPoolService: FinancingPoolService) {}

  @Post('fund')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiHeader({
    name: 'Idempotency-Key',
    description: 'Unique UUID to prevent duplicate requests',
    required: true,
    schema: {
      type: 'string',
      format: 'uuid',
      example: '123e4567-e89b-12d3-a456-426614174000',
    },
  })
  @ApiOperation({ 
    summary: 'Fund an invoice',
    description: 'Funds a verified invoice. Requires Idempotency-Key header.',
  })
  @ApiResponse({
    status: 200,
    description: 'Invoice funded successfully',
    type: FundResponseDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Invoice funded successfully (first-time)',
    type: FundResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Missing Idempotency-Key or invalid UUID' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Idempotency key belongs to different user' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  @ApiResponse({ status: 409, description: 'Invoice already funded' })
  @HttpCode(200)
  async fundInvoice(
    @Request() req: any,
    @Body() fundInvoiceDto: FundInvoiceDto,
  ): Promise<FundResponseDto> {
    return this.financingPoolService.fundInvoice(
      req.user.userId,
      fundInvoiceDto.invoiceId,
    );
  }
}
