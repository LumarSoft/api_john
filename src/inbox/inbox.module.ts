import { Module } from '@nestjs/common'
import { AdminInboxController } from './admin-inbox.controller'
import { InboxService } from './inbox.service'
import { BotNotifierService } from './bot-notifier.service'

@Module({
  controllers: [AdminInboxController],
  providers: [InboxService, BotNotifierService],
})
export class InboxModule {}
