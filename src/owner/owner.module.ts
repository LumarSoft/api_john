import { Module } from '@nestjs/common'
import { OwnerService } from './owner.service'
import { OwnerController } from './owner.controller'
import { UsageModule } from '../usage/usage.module'

@Module({
  imports: [UsageModule],
  providers: [OwnerService],
  controllers: [OwnerController],
})
export class OwnerModule {}
