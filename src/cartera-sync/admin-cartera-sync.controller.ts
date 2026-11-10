import { Controller, Post, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { Role } from 'generated/prisma/client'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { CarteraSyncService } from './cartera-sync.service'

/** Manual trigger so a SuperAdmin can run the Triunfo cartera import of its own
 *  organization on demand (e.g. the initial migration) without waiting for the cron. */
@UseGuards(UserAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
@Controller('admin/cartera-sync')
export class AdminCarteraSyncController {
  constructor(private readonly carteraSync: CarteraSyncService) {}

  @Post()
  run(@Request() req: AuthenticatedRequest) {
    // Only the caller's organization: one SuperAdmin never fires another's
    // Triunfo calls. Waits its turn; returns { codesProcessed, synced, skipped }.
    return this.carteraSync.syncOrganization(req.user.producerId)
  }
}
