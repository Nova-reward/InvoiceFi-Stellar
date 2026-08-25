import { Global, Module } from '@nestjs/common';
import { VaultService } from './vault.service';

/**
 * VaultModule
 *
 * Marked @Global so VaultService is available everywhere in the application
 * without needing to re-import VaultModule in each feature module.
 *
 * Must be imported FIRST in AppModule so secrets are available before any
 * other service's onModuleInit / onApplicationBootstrap runs.
 */
@Global()
@Module({
  providers: [VaultService],
  exports: [VaultService],
})
export class VaultModule {}
