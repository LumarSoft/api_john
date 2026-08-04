import { Module } from '@nestjs/common'
import { UsageService } from './usage.service'
import { BotUsageController } from './bot-usage.controller'
import { AdminUsageController } from './admin-usage.controller'

@Module({
  providers: [UsageService],
  controllers: [BotUsageController, AdminUsageController],
  exports: [UsageService],
})
export class UsageModule {}
