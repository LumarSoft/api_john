import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './auth/auth.module'
import { TriunfoModule } from './triunfo/triunfo.module'
import { CotizadorModule } from './cotizador/cotizador.module'

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuthModule, TriunfoModule, CotizadorModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
