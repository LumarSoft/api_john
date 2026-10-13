import { Module } from '@nestjs/common'
import { AdminTasksController } from './admin-tasks.controller'
import { TasksService } from './tasks.service'

@Module({
  controllers: [AdminTasksController],
  providers: [TasksService],
})
export class TasksModule {}
