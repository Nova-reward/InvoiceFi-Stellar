import { Body, Controller, Post, Request, UseFilters, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ContractErrorFilter } from '../common/contract-error.filter';
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
  @ApiOperation({ summary: 'Settle a funded invoice and distribute funds' })
  @ApiResponse({ status: 201, description: 'Invoice settled', type: SettlementResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Unauthorized – not the invoice owner', type: ContractErrorDto })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  @ApiResponse({ status: 409, description: 'InvalidState – already settled or not funded', type: ContractErrorDto })
  settle(@Request() req, @Body() dto: SettleInvoiceDto) {
    return this.service.settle(req.user.userId, req.user.walletAddress, dto);
  }
}
