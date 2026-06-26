import { Module } from '@nestjs/common'
import { PhoneNumbersService } from './phone-numbers.service'
import { AdminPhoneNumbersController } from './admin-phone-numbers.controller'

@Module({
  providers: [PhoneNumbersService],
  controllers: [AdminPhoneNumbersController],
})
export class PhoneNumbersModule {}
