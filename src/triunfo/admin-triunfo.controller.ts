import { Controller, Get, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { TriunfoErrorsService } from './triunfo-errors.service'

/** The office's view of its Triunfo connection: the panel warns while Triunfo refuses the credentials. */
@UseGuards(UserAuthGuard)
@Controller('admin/triunfo')
export class AdminTriunfoController {
  constructor(private readonly errors: TriunfoErrorsService) {}

  @Get('status')
  status(@Request() req: AuthenticatedRequest) {
    return this.errors.authState(req.user.producerId)
  }
}
