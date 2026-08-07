import { Module } from '@nestjs/common'
import { CoverageSettingsService } from './coverage-settings.service'
import { AdminCoverageSettingsController } from './admin-coverage-settings.controller'

@Module({
  controllers: [AdminCoverageSettingsController],
  providers: [CoverageSettingsService],
  exports: [CoverageSettingsService],
})
export class CoverageSettingsModule {}
