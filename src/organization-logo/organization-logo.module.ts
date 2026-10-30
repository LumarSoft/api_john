import { Module } from '@nestjs/common'
import { AdminLogoController, OwnerLogoController } from './organization-logo.controller'
import { OrganizationLogoService } from './organization-logo.service'

@Module({
  controllers: [AdminLogoController, OwnerLogoController],
  providers: [OrganizationLogoService],
})
export class OrganizationLogoModule {}
