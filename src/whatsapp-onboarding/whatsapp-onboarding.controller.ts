import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Role } from 'generated/prisma/client'
import { UserAuthGuard } from '../auth/user-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { AuthenticatedRequest } from '../common/types/authenticated-request.type'
import { WhatsappOnboardingService } from './whatsapp-onboarding.service'
import { OnboardWhatsappDto } from './dto/onboard.dto'

@UseGuards(UserAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
@Controller('admin/whatsapp')
export class WhatsappOnboardingController {
  constructor(
    private readonly service: WhatsappOnboardingService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Public-ish config the browser needs to launch Embedded Signup. Only ids that
   * are visible in the page source anyway — never the app secret.
   */
  @Get('embedded-signup-config')
  embeddedSignupConfig() {
    return {
      appId: this.config.get<string>('META_APP_ID') ?? null,
      configId: this.config.get<string>('META_ES_CONFIG_ID') ?? null,
      graphVersion: this.config.get<string>('META_GRAPH_VERSION') ?? 'v25.0',
      ready: Boolean(this.config.get('META_APP_ID') && this.config.get('META_ES_CONFIG_ID')),
    }
  }

  @Post('onboard')
  onboard(@Request() req: AuthenticatedRequest, @Body() dto: OnboardWhatsappDto) {
    return this.service.onboard(req.user.producerId, dto)
  }
}
