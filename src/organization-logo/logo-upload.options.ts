import { BadRequestException } from '@nestjs/common'
import { memoryStorage } from 'multer'
import type { Request } from 'express'
import { LOGO_MIME_TYPES, MAX_LOGO_SIZE } from './organization-logo.service'

/** One image in memory: the service converts it before anything touches the disk. */
export const logoUploadOptions = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_LOGO_SIZE, files: 1 },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, acceptFile: boolean) => void) => {
    if (!LOGO_MIME_TYPES.has(file.mimetype)) {
      cb(new BadRequestException('El logo tiene que ser PNG, JPG o WebP.'), false)
      return
    }
    cb(null, true)
  },
}
