import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'
import { TriunfoModule } from './triunfo/triunfo.module'
import { CotizadorModule } from './cotizador/cotizador.module'
import { InfoAutoModule } from './infoauto/infoauto.module'
import { ClientsModule } from './clients/clients.module'
import { CarteraSyncModule } from './cartera-sync/cartera-sync.module'
import { SiniestrosModule } from './siniestros/siniestros.module'
import { DocumentosModule } from './documentos/documentos.module'
import { MailModule } from './mail/mail.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    TriunfoModule,
    CotizadorModule,
    InfoAutoModule,
    ClientsModule,
    CarteraSyncModule,
    MailModule,
    SiniestrosModule,
    DocumentosModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
