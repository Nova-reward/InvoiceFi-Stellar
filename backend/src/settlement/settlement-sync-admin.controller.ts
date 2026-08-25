import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SettlementSyncService } from './settlement-sync.service';
import { BackfillDto, BackfillResponseDto } from './dto/backfill.dto';

/**
 * Admin-only operations for the settlement sync pipeline.
 *
 * All endpoints require a valid JWT with `role === 'admin'`.
 */
@ApiTags('admin / settlement-sync')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin/settlement-sync')
export class SettlementSyncAdminController {
  constructor(private readonly sync: SettlementSyncService) {}

  /**
   * Re-process a specific ledger range without duplicating already-settled
   * invoices. Useful for recovering from gaps caused by RPC outages or
   * deploying a new contract while the listener was running.
   *
   * The live cursor is NOT modified — the polling loop remains authoritative.
   */
  @Post('backfill')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Backfill settlement events for a ledger range',
    description:
      'Re-processes InvoiceSettled events between fromLedger and toLedger ' +
      '(both inclusive). Already-settled invoices are skipped idempotently. ' +
      'The live sync cursor is not modified.',
  })
  @ApiResponse({
    status: 200,
    description: 'Backfill completed',
    type: BackfillResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async backfill(@Body() dto: BackfillDto): Promise<BackfillResponseDto> {
    return this.sync.backfill(dto.fromLedger, dto.toLedger);
  }
}
