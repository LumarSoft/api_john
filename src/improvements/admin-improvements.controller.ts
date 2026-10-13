import { Controller, Get, Post, Query, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { ListImprovementsDto } from './dto/list-improvements.dto'
import { ImprovementsService } from './improvements.service'

/**
 * "Mejoras" for the organization's users: read-only, scoped to the caller's
 * organization plus the improvements published for everyone.
 */
@UseGuards(UserAuthGuard)
@Controller('admin/improvements')
export class AdminImprovementsController {
  constructor(private readonly improvements: ImprovementsService) {}

  @Get()
  list(@Request() req: AuthenticatedRequest, @Query() query: ListImprovementsDto) {
    return this.improvements.listPublished(req.user.producerId, query)
  }

  @Get('unseen-count')
  unseenCount(@Request() req: AuthenticatedRequest) {
    return this.improvements.countUnseen(req.user.id, req.user.producerId)
  }

  @Post('visit')
  visit(@Request() req: AuthenticatedRequest) {
    return this.improvements.registerVisit(req.user.id, req.user.producerId)
  }
}
