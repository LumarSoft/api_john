import { Module } from '@nestjs/common'
import { NoticeDeliveryService } from './notice-delivery.service'

/** Shared by every feature that writes first to a client with a Meta template. */
@Module({
  providers: [NoticeDeliveryService],
  exports: [NoticeDeliveryService],
})
export class NoticesModule {}
