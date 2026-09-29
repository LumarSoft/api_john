import { NestFactory } from '@nestjs/core'
import { ValidationPipe, BadRequestException, Logger } from '@nestjs/common'
import { NestExpressApplication } from '@nestjs/platform-express'
import { join } from 'path'
import type { ServerResponse } from 'http'
import { AppModule } from './app.module'
import { requireSignedAdjunto } from './siniestros/adjunto-url'
import { SINIESTROS_PUBLIC_PREFIX } from './siniestros/siniestro-upload.config'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)

  // Coexistence history arrives in chunks containing many messages and raw
  // media metadata. Express' 100 KB default can reject a valid Meta webhook
  // after the bot forwards it to this API.
  app.useBodyParser('json', { limit: '10mb' })

  // CORS_ORIGIN accepts a comma-separated list, e.g.
  //   https://www.jpmanagementgroup.com.ar,https://jpmanagementgroup.com.ar
  //
  // Trailing slashes are stripped: the browser's `Origin` header never carries
  // one, so "http://localhost:3000/" would silently fail every preflight.
  const corsOrigin = (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map(o => o.trim().replace(/\/+$/, ''))
    .filter(Boolean)

  app.enableCors({
    origin: corsOrigin.length === 1 ? corsOrigin[0] : corsOrigin,
    credentials: true,
  })

  // Claim photos are personal documents: only URLs signed by the API (see
  // adjunto-url.ts) get through. Must be registered before the static handler.
  app.use(SINIESTROS_PUBLIC_PREFIX, requireSignedAdjunto)

  // Serve uploaded files (siniestro attachments, etc.) with CORS headers so the
  // front can fetch/render them without being blocked by the browser.
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads',
    setHeaders: (res: ServerResponse) => {
      res.setHeader('Access-Control-Allow-Origin', corsOrigin)
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    },
  })

  const validationLogger = new Logger('ValidationPipe')

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: errors => {
        validationLogger.warn(
          `Validation failed — ${errors.map(e => `[${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}]`).join(' ')}`,
        )
        return new BadRequestException(errors)
      },
    }),
  )

  const port = process.env.PORT ?? 3000
  await app.listen(port)
  new Logger('Bootstrap').log(`App running on port ${port}`)
}

void bootstrap()
