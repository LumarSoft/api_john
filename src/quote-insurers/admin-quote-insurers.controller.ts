import { Body, Controller, Get, Patch, Request, UseGuards } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { UpdateQuoteInsurersDto } from './dto/update-quote-insurers.dto'
import { QuoteInsurersService } from './quote-insurers.service'

/**
 * "Configuración → Aseguradoras": which insurers the organization's bot quotes
 * with. Everyone reads it; only the SuperAdmin switches them, since it decides
 * whose prices the customers get.
 */
@UseGuards(UserAuthGuard, RolesGuard)
@Controller('admin/config/insurers')
export class AdminQuoteInsurersController {
  constructor(private readonly insurers: QuoteInsurersService) {}

  @Get()
  get(@Request() req: AuthenticatedRequest) {
    return this.insurers.status(req.user.producerId)
  }

  @Patch()
  @Roles(Role.SUPERADMIN)
  update(@Request() req: AuthenticatedRequest, @Body() dto: UpdateQuoteInsurersDto) {
    return this.insurers.update(req.user.producerId, dto)
  }
}
