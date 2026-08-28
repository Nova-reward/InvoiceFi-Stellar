import { Body, Controller, Post, Request, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ContractErrorFilter } from '../common/contract-error.filter';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { SettlementService } from './settlement.service';
import { SettleInvoiceDto, SettlementResponseDto } from './dto/settlement.dto';
import { ContractErrorDto } from '../financing-pool/dto/funding.dto';

@ApiTags('settlement')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@UseFilters(ContractErrorFilter)
@Controller('settlement')
export class SettlementController {
  constructor(private service: SettlementService) {}

  @Post('settle')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiHeader({
    name: 'Idempotency-Key',
    description: 'Unique UUID to prevent duplicate settlement',
    required: true,
    schema: { type: 'string', format: 'uuid', example: '123e4567-e89b-12d3-a456-426614174000' },
  })
  @ApiOperation({ summary: 'Settle a funded invoice and distribute funds' })
  @ApiResponse({ status: 201, description: 'Invoice settled', type: SettlementResponseDto })
  @ApiResponse({ status: 400, description: 'Missing Idempotency-Key or invalid UUID' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Unauthorized – not the invoice owner', type: ContractErrorDto })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  @ApiResponse({ status: 409, description: 'InvalidState – already settled or not funded, or key reused with different body', type: ContractErrorDto })
  settle(@Request() req, @Body() dto: SettleInvoiceDto) {
    return this.service.settle(req.user.userId, req.user.walletAddress, dto);
  }
}
