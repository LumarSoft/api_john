import { Module } from '@nestjs/common'
import { UsageModule } from '../usage/usage.module'
import { PhoneNumbersService } from './phone-numbers.service'
import { AdminPhoneNumbersController } from './admin-phone-numbers.controller'

@Module({
  imports: [UsageModule],
  providers: [PhoneNumbersService],
  controllers: [AdminPhoneNumbersController],
})
export class PhoneNumbersModule {}
