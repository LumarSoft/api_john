import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Request, UseGuards } from '@nestjs/common'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { ProductPlansService } from './product-plans.service'
import { CreatePlanDto } from './dto/create-plan.dto'
import { UpdatePlanDto } from './dto/update-plan.dto'

@UseGuards(UserAuthGuard)
@Controller('admin/pricing')
export class AdminPricingController {
  constructor(private readonly productPlansService: ProductPlansService) {}

  @Get()
  findAll(@Request() req: AuthenticatedRequest) {
    return this.productPlansService.listForAdmin(req.user.producerId)
  }

  @Post()
  create(@Body() dto: CreatePlanDto, @Request() req: AuthenticatedRequest) {
    return this.productPlansService.create(req.user.producerId, dto)
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePlanDto, @Request() req: AuthenticatedRequest) {
    return this.productPlansService.update(req.user.producerId, id, dto)
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    return this.productPlansService.remove(req.user.producerId, id)
  }
}
