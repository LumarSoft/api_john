import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { ActivityLogMiddleware } from './activity-log.middleware'
import { ActivityLogService } from './activity-log.service'
import { OwnerActivityLogController } from './owner-activity-log.controller'

@Module({
  controllers: [OwnerActivityLogController],
  providers: [ActivityLogService],
})
export class ActivityLogModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ActivityLogMiddleware).forRoutes('{*splat}')
  }
}
