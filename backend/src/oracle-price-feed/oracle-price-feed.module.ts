import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SorobanService } from '../soroban/soroban.service';
import { OraclePriceFeedService } from './oracle-price-feed.service';

@Module({
  imports: [],
  controllers: [],
  providers: [
    OraclePriceFeedService,
    {
      provide: SorobanService,
      useClass: SorobanService,
    },
  ],
  exports: [OraclePriceFeedService],
})
export class OraclePriceFeedModule {}