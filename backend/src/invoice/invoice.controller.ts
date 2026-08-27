import { Body, Controller, Get, Param, Post, Request, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { InvoiceService } from './invoice.service';
import { CreateInvoiceDto, InvoiceResponseDto } from './dto/invoice.dto';

@ApiTags('invoices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('invoices')
export class InvoiceController {
  constructor(private invoiceService: InvoiceService) {}

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  @ApiHeader({
    name: 'Idempotency-Key',
    description: 'Unique UUID to prevent duplicate invoice creation',
    required: true,
    schema: { type: 'string', format: 'uuid', example: '123e4567-e89b-12d3-a456-426614174000' },
  })
  @ApiOperation({ summary: 'Mint a new harvest invoice' })
  @ApiResponse({ status: 201, description: 'Invoice created', type: InvoiceResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error or missing Idempotency-Key' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 409, description: 'Idempotency key reused with a different body' })
  create(@Request() req, @Body() dto: CreateInvoiceDto) {
    return this.invoiceService.create(req.user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List invoices for authenticated user' })
  @ApiResponse({ status: 200, description: 'Invoice list', type: [InvoiceResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(@Request() req) {
    return this.invoiceService.findAll(req.user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get invoice by ID' })
  @ApiResponse({ status: 200, description: 'Invoice details', type: InvoiceResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  findOne(@Param('id') id: string) {
    return this.invoiceService.findOne(id);
  }
}
