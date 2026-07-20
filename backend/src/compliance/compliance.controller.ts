import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ComplianceService } from './compliance.service';
import { ErasureRequestDto } from './dto/compliance.dto';

@Controller('compliance')
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Post('erasure-requests')
  async requestErasure(@Body() dto: ErasureRequestDto) {
    return this.complianceService.requestErasure(dto);
  }

  @Get('data-export/:userId')
  async exportPersonalData(@Param('userId') userId: string) {
    return this.complianceService.exportPersonalData(userId);
  }
}
