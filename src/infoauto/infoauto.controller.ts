import { Controller, Get, Param, Query } from '@nestjs/common'
import { InfoAutoService } from './infoauto.service'
import { InfoAutoQueryDto } from './dto/infoauto-query.dto'
import { BrandIdParamDto } from './dto/brand-id-param.dto'
import { GroupParamsDto } from './dto/group-params.dto'

@Controller('infoauto')
export class InfoAutoController {
  constructor(private readonly infoAutoService: InfoAutoService) {}

  @Get('brands')
  getBrands(@Query() query: InfoAutoQueryDto) {
    return this.infoAutoService.getBrands(query)
  }

  @Get('brands/:brandId/groups')
  getGroups(@Param() params: BrandIdParamDto, @Query() query: InfoAutoQueryDto) {
    return this.infoAutoService.getGroups(params.brandId, query)
  }

  @Get('brands/:brandId/groups/:groupId/models')
  getModels(@Param() params: GroupParamsDto, @Query() query: InfoAutoQueryDto) {
    return this.infoAutoService.getModels(params.brandId, params.groupId, query)
  }
}
