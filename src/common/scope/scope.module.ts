import { Global, Module } from '@nestjs/common'
import { ScopeService } from './scope.service'

/** Global so any admin-facing module can scope queries by accessible codes. */
@Global()
@Module({
  providers: [ScopeService],
  exports: [ScopeService],
})
export class ScopeModule {}
