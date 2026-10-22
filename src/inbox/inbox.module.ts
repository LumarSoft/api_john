import { Module } from '@nestjs/common'
import { AdminInboxController } from './admin-inbox.controller'
import { InboxService } from './inbox.service'
import { BotNotifierService } from './bot-notifier.service'
import { BotTakeoverTimeoutService } from './bot-takeover-timeout.service'
import { NovedadesModule } from '../novedades/novedades.module'

@Module({
  imports: [NovedadesModule],
  controllers: [AdminInboxController],
  providers: [InboxService, BotNotifierService, BotTakeoverTimeoutService],
  exports: [BotNotifierService],
})
export class InboxModule {}
