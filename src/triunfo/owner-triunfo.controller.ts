import { Body, Controller, Delete, Get, Param, ParseIntPipe, Put, UseGuards } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { TriunfoCredentialsService } from './triunfo-credentials.service'
import { SaveTriunfoCredentialDto } from './dto/save-triunfo-credential.dto'

/** Platform OWNER: each organization's own Triunfo web-service access. */
@UseGuards(UserAuthGuard, RolesGuard)
@Roles(Role.OWNER)
@Controller('owner/organizations/:id/triunfo')
export class OwnerTriunfoController {
  constructor(private readonly credentials: TriunfoCredentialsService) {}

  @Get()
  status(@Param('id', ParseIntPipe) id: number) {
    return this.credentials.status(id)
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
