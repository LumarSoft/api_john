import { Module } from '@nestjs/common'
import { AdminInboxController } from './admin-inbox.controller'
import { InboxService } from './inbox.service'
import { BotNotifierService } from './bot-notifier.service'
import { BotTakeoverTimeoutService } from './bot-takeover-timeout.service'

@Module({
  controllers: [AdminInboxController],
  providers: [InboxService, BotNotifierService, BotTakeoverTimeoutService],
})
export class InboxModule {}
