import { Global, Module } from '@nestjs/common';
import { SorobanService } from './soroban.service';

@Global()
@Module({
  providers: [SorobanService],
  exports: [SorobanService],
})
export class SorobanModule {}
