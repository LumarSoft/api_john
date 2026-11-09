import { Module } from '@nestjs/common'
import { InboxModule } from '../inbox/inbox.module'
import { NoticesModule } from '../notices/notices.module'
import { AdminExpiredPoliciesController } from './admin-expired-policies.controller'
import { ExpiredPoliciesService } from './expired-policies.service'

@Module({
  imports: [InboxModule, NoticesModule],
  controllers: [AdminExpiredPoliciesController],
  providers: [ExpiredPoliciesService],
})
export class ExpiredPoliciesModule {}
