import { Controller, Post, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { Role } from 'generated/prisma/client'
import { CarteraSyncService } from './cartera-sync.service'

/** Manual trigger so a SuperAdmin can run the Triunfo cartera import on demand
 *  (e.g. the initial migration) without restarting the API or waiting for the cron. */
@UseGuards(UserAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
@Controller('admin/cartera-sync')
export class AdminCarteraSyncController {
  constructor(private readonly carteraSync: CarteraSyncService) {}

  @Post()
  run() {
    // Overlap-guarded; returns the summary { codesProcessed, synced, skipped }.
    return this.carteraSync.runGuarded()
  }
}
