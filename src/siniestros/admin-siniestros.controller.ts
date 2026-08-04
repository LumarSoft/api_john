import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { ScopeService } from '../common/scope/scope.service'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { SiniestrosService } from './siniestros.service'
import { ListSiniestrosDto } from './dto/list-siniestros.dto'
import { UpdateSiniestroDto } from './dto/update-siniestro.dto'

@UseGuards(UserAuthGuard)
@Controller('admin/siniestros')
export class AdminSiniestrosController {
  constructor(
    private readonly siniestrosService: SiniestrosService,
    private readonly scope: ScopeService,
  ) {}

  @Get()
  async findAll(@Query() query: ListSiniestrosDto, @Request() req: AuthenticatedRequest) {
    const codeIds = await this.scope.resolveScopedCodeIdsFor(req.user, {
      producerCodeId: query.producerCodeId,
      phoneNumberId: query.phoneNumberId,
    })
    return this.siniestrosService.findAllForAdmin(req.user.producerId, codeIds, query)
  }

  @Get('stats')
  async getStats(@Request() req: AuthenticatedRequest) {
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(req.user)
    return this.siniestrosService.getAdminStats(req.user.producerId, codeIds)
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(req.user)
    return this.siniestrosService.findOneForAdmin(id, req.user.producerId, codeIds)
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSiniestroDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const codeIds = await this.scope.resolveAccessibleProducerCodeIds(req.user)
    return this.siniestrosService.updateForAdmin(id, req.user.producerId, codeIds, dto)
  }
}
