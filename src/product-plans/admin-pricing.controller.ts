import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Request, UseGuards } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { ProductPlansService } from './product-plans.service'
import { CreatePlanDto } from './dto/create-plan.dto'
import { UpdatePlanDto } from './dto/update-plan.dto'

// The organization's prices: everyone reads them, only the SuperAdmin changes them.
@UseGuards(UserAuthGuard, RolesGuard)
@Controller('admin/pricing')
export class AdminPricingController {
  constructor(private readonly productPlansService: ProductPlansService) {}

  @Get()
  findAll(@Request() req: AuthenticatedRequest) {
    return this.productPlansService.listForAdmin(req.user.producerId)
  }

  @Post()
  @Roles(Role.SUPERADMIN, Role.ADMIN)
  create(@Body() dto: CreatePlanDto, @Request() req: AuthenticatedRequest) {
    return this.productPlansService.create(req.user.producerId, dto)
  }

  @Patch(':id')
  @Roles(Role.SUPERADMIN, Role.ADMIN)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePlanDto, @Request() req: AuthenticatedRequest) {
    return this.productPlansService.update(req.user.producerId, id, dto)
  }

  @Delete(':id')
  @Roles(Role.SUPERADMIN, Role.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number, @Request() req: AuthenticatedRequest) {
    return this.productPlansService.remove(req.user.producerId, id)
  }
}
