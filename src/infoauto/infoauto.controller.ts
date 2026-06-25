import { Controller, Get, Param, Query } from '@nestjs/common'
import { InfoAutoService } from './infoauto.service'
import { InfoAutoQueryDto } from './dto/infoauto-query.dto'
import { VehicleTypeParamDto } from './dto/vehicle-type-param.dto'
import { BrandIdParamDto } from './dto/brand-id-param.dto'
import { GroupParamsDto } from './dto/group-params.dto'
import { vehicleTypeFromParam } from './infoauto.types'

@Controller('infoauto/:vehicleType')
export class InfoAutoController {
  constructor(private readonly infoAutoService: InfoAutoService) {}

  @Get('brands')
  getBrands(@Param() params: VehicleTypeParamDto, @Query() query: InfoAutoQueryDto) {
    return this.infoAutoService.getBrands(vehicleTypeFromParam(params.vehicleType), query)
  }

  @Get('brands/:brandId/groups')
  getGroups(@Param() params: BrandIdParamDto, @Query() query: InfoAutoQueryDto) {
    return this.infoAutoService.getGroups(vehicleTypeFromParam(params.vehicleType), params.brandId, query)
  }

  @Get('brands/:brandId/groups/:groupId/models')
  getModels(@Param() params: GroupParamsDto, @Query() query: InfoAutoQueryDto) {
    return this.infoAutoService.getModels(
      vehicleTypeFromParam(params.vehicleType),
      params.brandId,
      params.groupId,
      query,
    )
  }
}
