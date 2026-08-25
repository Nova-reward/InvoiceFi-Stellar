import { Controller, Get } from '@nestjs/common';
import { PoolService } from './pool.service';

@Controller('pool')
export class PoolController {
  constructor(private readonly poolService: PoolService) {}

  @Get('stats')
  async getStats() {
    return this.poolService.getPoolStats();
  }
}
