import { Module } from '@nestjs/common'
import { UsersService } from './users.service'
import { UsersController } from './users.controller'
import { AdminConfigController } from './admin-config.controller'
import { AuthModule } from '../auth/auth.module'
import { BotStatusAlertService } from './bot-status-alert.service'

@Module({
  imports: [AuthModule],
  providers: [UsersService, BotStatusAlertService],
  controllers: [UsersController, AdminConfigController],
})
export class UsersModule {}
