import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { TasksService } from './tasks.service'
import { CreateTaskCommentDto, CreateTaskDto, ListTasksDto, UpdateTaskDto } from './dto/task.dto'

/** Internal tasks the office leaves each other ("Tareas" in the panel). */
@UseGuards(UserAuthGuard)
@Controller('admin/tasks')
export class AdminTasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(@Query() dto: ListTasksDto, @Request() req: AuthenticatedRequest) {
    return this.tasks.list(req.user, dto)
  }

  @Get('stats')
  stats(@Request() req: AuthenticatedRequest) {
    return this.tasks.stats(req.user)
  }

  @Get('people')
  people(@Request() req: AuthenticatedRequest) {
    return this.tasks.people(req.user.producerId)
  }

  @Post('seen')
  markSeen(@Request() req: AuthenticatedRequest) {
    return this.tasks.markSeen(req.user)
  }

  @Post()
  create(@Body() dto: CreateTaskDto, @Request() req: AuthenticatedRequest) {
    return this.tasks.create(req.user, dto)
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTaskDto, @Request() req: AuthenticatedRequest) {
    return this.tasks.update(req.user, id, dto)
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    return this.tasks.remove(req.user, id)
  }

  @Post(':id/comments')
  addComment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateTaskCommentDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.tasks.addComment(req.user, id, dto)
  }
}
