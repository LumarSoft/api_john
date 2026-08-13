import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { PrismaModule } from './prisma/prisma.module'
import { ScopeModule } from './common/scope/scope.module'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'
import { TriunfoModule } from './triunfo/triunfo.module'
import { CotizadorModule } from './cotizador/cotizador.module'
import { CoverageSettingsModule } from './coverage-settings/coverage-settings.module'
import { InfoAutoModule } from './infoauto/infoauto.module'
import { ClientsModule } from './clients/clients.module'
import { CarteraSyncModule } from './cartera-sync/cartera-sync.module'
import { SiniestrosModule } from './siniestros/siniestros.module'
import { DocumentosModule } from './documentos/documentos.module'
import { BotModule } from './bot/bot.module'
import { MailModule } from './mail/mail.module'
import { InboxModule } from './inbox/inbox.module'
import { NovedadesModule } from './novedades/novedades.module'
import { SolicitudesModule } from './solicitudes/solicitudes.module'
import { ProductPlansModule } from './product-plans/product-plans.module'
import { PublicModule } from './public/public.module'
import { BusinessHoursModule } from './business-hours/business-hours.module'
import { DashboardModule } from './dashboard/dashboard.module'
import { UsageModule } from './usage/usage.module'
import { PhoneNumbersModule } from './phone-numbers/phone-numbers.module'
import { OwnerModule } from './owner/owner.module'
import { WhatsappOnboardingModule } from './whatsapp-onboarding/whatsapp-onboarding.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    ScopeModule,
    AuthModule,
    UsersModule,
    TriunfoModule,
    CotizadorModule,
    CoverageSettingsModule,
    InfoAutoModule,
    ClientsModule,
    CarteraSyncModule,
    MailModule,
    SiniestrosModule,
    DocumentosModule,
    BotModule,
    InboxModule,
    NovedadesModule,
    SolicitudesModule,
    ProductPlansModule,
    PublicModule,
    BusinessHoursModule,
    DashboardModule,
    UsageModule,
    PhoneNumbersModule,
    OwnerModule,
    WhatsappOnboardingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
