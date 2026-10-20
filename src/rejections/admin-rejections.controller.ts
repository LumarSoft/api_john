import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { RejectionsService } from './rejections.service'
import { CreatePaymentRejectionImportDto, PaymentRejectionIdsDto } from './dto/payment-rejection.dto'

/** "Rechazos" in the panel: Triunfo's Excel of rejected debits and the WhatsApp notices. */
@UseGuards(UserAuthGuard)
@Controller('admin/rejections')
export class AdminRejectionsController {
  constructor(private readonly rejections: RejectionsService) {}

  @Get()
  list(@Request() req: AuthenticatedRequest) {
    return this.rejections.list(req.user)
  }

  @Post()
  create(@Body() dto: CreatePaymentRejectionImportDto, @Request() req: AuthenticatedRequest) {
    return this.rejections.create(req.user, dto)
  }

  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    return this.rejections.detail(req.user, id)
  }

  @Post(':id/send')
  send(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PaymentRejectionIdsDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.rejections.send(req.user, id, dto.ids)
  }

  @Post(':id/mark')
  mark(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PaymentRejectionIdsDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.rejections.mark(req.user, id, dto.ids)
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    return this.rejections.remove(req.user, id)
  }
}
