import { Module } from '@nestjs/common'
import { AdminExpiredPoliciesController } from './admin-expired-policies.controller'
import { ExpiredPoliciesService } from './expired-policies.service'

@Module({
  controllers: [AdminExpiredPoliciesController],
  providers: [ExpiredPoliciesService],
})
export class ExpiredPoliciesModule {}
