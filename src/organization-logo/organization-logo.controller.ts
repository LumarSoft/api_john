import {
  Controller,
  Delete,
  Param,
  ParseIntPipe,
  Post,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Role } from 'generated/prisma/client'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { OrganizationLogoService } from './organization-logo.service'
import { logoUploadOptions } from './logo-upload.options'

/** The SuperAdmin sets its organization's logo (Configuración). */
@UseGuards(UserAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
@Controller('admin/config/logo')
export class AdminLogoController {
  constructor(private readonly logos: OrganizationLogoService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', logoUploadOptions))
  upload(@UploadedFile() file: Express.Multer.File | undefined, @Request() req: AuthenticatedRequest) {
    return this.logos.save(req.user.producerId, file)
  }

  @Delete()
  remove(@Request() req: AuthenticatedRequest) {
    return this.logos.remove(req.user.producerId)
  }
}

/** The owner sets any organization's logo (Organizaciones → detalle). */
@UseGuards(UserAuthGuard, RolesGuard)
@Roles(Role.OWNER)
@Controller('owner/organizations/:id/logo')
export class OwnerLogoController {
  constructor(private readonly logos: OrganizationLogoService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', logoUploadOptions))
  upload(@Param('id', ParseIntPipe) id: number, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.logos.save(id, file)
  }

  @Delete()
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.logos.remove(id)
  }
}
