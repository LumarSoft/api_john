import { BadRequestException } from '@nestjs/common'
import { existsSync, mkdirSync } from 'fs'
import { extname, join } from 'path'
import { diskStorage } from 'multer'
import type { Request } from 'express'

export const SINIESTROS_UPLOAD_DIR = join(process.cwd(), 'uploads', 'siniestros')
export const SINIESTROS_PUBLIC_PREFIX = '/uploads/siniestros'

export const MAX_FILES = 5
export const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])

type MulterFile = Express.Multer.File
type FilenameCallback = (error: Error | null, filename: string) => void
type FileFilterCallback = (error: Error | null, acceptFile: boolean) => void

function buildFilename(file: MulterFile): string {
  const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`
  return `${unique}${extname(file.originalname).toLowerCase()}`
}

/**
 * Multer options for siniestro attachments: disk storage under uploads/siniestros,
 * unique filenames, images + PDF only, capped size and count.
 */
export const siniestroMulterOptions = {
  storage: diskStorage({
    destination: (_req: Request, _file: MulterFile, cb: (error: Error | null, destination: string) => void) => {
      if (!existsSync(SINIESTROS_UPLOAD_DIR)) {
        mkdirSync(SINIESTROS_UPLOAD_DIR, { recursive: true })
      }
      cb(null, SINIESTROS_UPLOAD_DIR)
    },
    filename: (_req: Request, file: MulterFile, cb: FilenameCallback) => {
      cb(null, buildFilename(file))
    },
  }),
  fileFilter: (_req: Request, file: MulterFile, cb: FileFilterCallback) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new BadRequestException(`Tipo de archivo no permitido: ${file.mimetype}`), false)
      return
    }
    cb(null, true)
  },
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
}

export interface AdjuntoMeta {
  filename: string
  originalName: string
  url: string
  mimeType: string
  size: number
  // Optional category of the photo, set by the bot's guided claim flow:
  // 'tarjeta_verde' | 'carnet' | 'tarjeta_verde_tercero' | 'carnet_tercero' | 'otro'.
  tipo?: string
}

export function toAdjuntoMeta(file: MulterFile, tipo?: string): AdjuntoMeta {
  return {
    filename: file.filename,
    originalName: file.originalname,
    url: `${SINIESTROS_PUBLIC_PREFIX}/${file.filename}`,
    mimeType: file.mimetype,
    size: file.size,
    ...(tipo ? { tipo } : {}),
  }
}
