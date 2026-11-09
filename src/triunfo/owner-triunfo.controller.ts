import { Body, Controller, Delete, Get, Param, ParseIntPipe, Put, UseGuards } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { TriunfoCredentialsService } from './triunfo-credentials.service'
import { TriunfoErrorsService } from './triunfo-errors.service'
import { SaveTriunfoCredentialDto } from './dto/save-triunfo-credential.dto'

/** Platform OWNER: each organization's own Triunfo web-service access, and how its calls are failing. */
@UseGuards(UserAuthGuard, RolesGuard)
@Roles(Role.OWNER)
@Controller('owner/organizations/:id/triunfo')
export class OwnerTriunfoController {
  constructor(
    private readonly credentials: TriunfoCredentialsService,
    private readonly errors: TriunfoErrorsService,
  ) {}

  @Get()
  status(@Param('id', ParseIntPipe) id: number) {
    return this.credentials.status(id)
  }

  @Get('errors')
  listErrors(@Param('id', ParseIntPipe) id: number) {
    return this.errors.list(id)
  }

  @Put()
  save(@Param('id', ParseIntPipe) id: number, @Body() dto: SaveTriunfoCredentialDto) {
    return this.credentials.save(id, dto)
  }

  @Delete()
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.credentials.remove(id)
  }
}
