import { Body, Controller, Get, Param, ParseIntPipe, Patch, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { CoverageSettingsService } from './coverage-settings.service'
import { UpdateCoverageSettingDto } from './dto/update-coverage-setting.dto'
import { ReorderCoverageSettingsDto } from './dto/reorder-coverage-settings.dto'

/**
 * Coverage rows are never created or deleted by hand: they appear when Triunfo
 * quotes a code for the first time. The admin only edits them — turning them on
 * or off, renaming them and setting their order.
 */
@UseGuards(UserAuthGuard)
@Controller('admin/coberturas')
export class AdminCoverageSettingsController {
  constructor(private readonly coverageSettingsService: CoverageSettingsService) {}

  @Get()
  findAll(@Request() req: AuthenticatedRequest) {
    return this.coverageSettingsService.listForAdmin(req.user.producerId)
  }

  @Patch('orden')
  reorder(@Body() dto: ReorderCoverageSettingsDto, @Request() req: AuthenticatedRequest) {
    return this.coverageSettingsService.reorder(req.user.producerId, dto)
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCoverageSettingDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.coverageSettingsService.update(req.user.producerId, id, dto)
  }
}
