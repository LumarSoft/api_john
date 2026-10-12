import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { ImprovementsService } from './improvements.service'
import { CreateImprovementDto, UpdateImprovementDto } from './dto/improvement.dto'

/** Lumar (OWNER) writes, publishes and withdraws the improvements every organization reads. */
@UseGuards(UserAuthGuard, RolesGuard)
@Roles(Role.OWNER)
@Controller('owner/improvements')
export class OwnerImprovementsController {
  constructor(private readonly improvements: ImprovementsService) {}

  @Get()
  list() {
    return this.improvements.listAll()
  }

  @Post()
  create(@Body() dto: CreateImprovementDto) {
    return this.improvements.create(dto)
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateImprovementDto) {
    return this.improvements.update(id, dto)
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.improvements.remove(id)
  }
}
