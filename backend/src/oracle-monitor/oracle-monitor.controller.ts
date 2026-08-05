import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { OracleMonitorService } from './oracle-monitor.service';
import { OracleHealthResponse } from './oracle-monitor.types';

@Controller('oracle')
export class OracleMonitorController {
  constructor(private readonly monitor: OracleMonitorService) {}

  @Get('health')
  @HttpCode(HttpStatus.OK)
  async getHealth(): Promise<OracleHealthResponse> {
    return this.monitor.getHealth();
  }

  @Post('poll')
  @HttpCode(HttpStatus.OK)
  async forcePoll(): Promise<{ polled: boolean }> {
    await this.monitor.forcePoll();
    return { polled: true };
  }
}
