import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { NestExpressApplication } from '@nestjs/platform-express'
import { join } from 'path'
import type { ServerResponse } from 'http'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)

  const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:3000'

  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  })

  // Serve uploaded files (siniestro attachments, etc.) with CORS headers so the
  // front can fetch/render them without being blocked by the browser.
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads',
    setHeaders: (res: ServerResponse) => {
      res.setHeader('Access-Control-Allow-Origin', corsOrigin)
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    },
  })

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )

  const port = process.env.PORT ?? 3000
  await app.listen(port)
  console.log(`App running on port ${port}`)
}
bootstrap()
