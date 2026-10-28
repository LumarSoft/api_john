import { Module } from '@nestjs/common'
import { UsageModule } from '../usage/usage.module'
import { UsersModule } from '../users/users.module'
import { CoverageSettingsModule } from '../coverage-settings/coverage-settings.module'
import { PhoneNumbersService } from './phone-numbers.service'
import { AdminPhoneNumbersController } from './admin-phone-numbers.controller'

@Module({
  imports: [UsageModule, UsersModule, CoverageSettingsModule],
  providers: [PhoneNumbersService],
  controllers: [AdminPhoneNumbersController],
})
export class PhoneNumbersModule {}
