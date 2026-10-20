import { Module } from '@nestjs/common'
import { InboxModule } from '../inbox/inbox.module'
import { AdminRejectionsController } from './admin-rejections.controller'
import { RejectionsService } from './rejections.service'

@Module({
  imports: [InboxModule],
  controllers: [AdminRejectionsController],
  providers: [RejectionsService],
})
export class RejectionsModule {}
