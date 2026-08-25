import { Body, Controller, Post, Request, UseFilters, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ContractErrorFilter } from '../common/contract-error.filter';
import { FinancingPoolService } from './financing-pool.service';
import { FundInvoiceDto, FundingResponseDto, ContractErrorDto } from './dto/funding.dto';

@ApiTags('financing-pool')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@UseFilters(ContractErrorFilter)
@Controller('financing-pool')
export class FinancingPoolController {
  constructor(private service: FinancingPoolService) {}

  @Post('fund')
  @ApiOperation({ summary: 'Fund an invoice from the liquidity pool' })
  @ApiResponse({ status: 201, description: 'Invoice funded', type: FundingResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  @ApiResponse({ status: 409, description: 'DuplicateFunding – invoice already funded', type: ContractErrorDto })
  @ApiResponse({ status: 410, description: 'InvoiceExpired – past expiry timestamp', type: ContractErrorDto })
  @ApiResponse({ status: 422, description: 'InsufficientFunds – amount exceeds balance', type: ContractErrorDto })
  fund(@Request() req, @Body() dto: FundInvoiceDto) {
    return this.service.fundInvoice(req.user.userId, req.user.walletAddress, dto);
  }
}
