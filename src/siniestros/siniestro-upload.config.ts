import { BadRequestException, Logger } from '@nestjs/common'
import { existsSync, mkdirSync } from 'fs'
import { rename, unlink } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import { diskStorage } from 'multer'
import sharp from 'sharp'
import type { Request } from 'express'

export const SINIESTROS_UPLOAD_DIR = join(process.cwd(), 'uploads', 'siniestros')
export const SINIESTROS_PUBLIC_PREFIX = '/uploads/siniestros'

// Documents a customer sends to take out a quoted policy (DNI, tarjeta azul).
export const LEADS_UPLOAD_DIR = join(process.cwd(), 'uploads', 'leads')
export const LEADS_PUBLIC_PREFIX = '/uploads/leads'

// WhatsApp voice notes, kept AUDIO_RETENTION_DAYS (see MessageRetentionService).
export const AUDIOS_UPLOAD_DIR = join(process.cwd(), 'uploads', 'audios')
export const AUDIOS_PUBLIC_PREFIX = '/uploads/audios'

/** Folders holding personal documents: served only through signed URLs. */
export const PROTECTED_UPLOAD_PREFIXES = [SINIESTROS_PUBLIC_PREFIX, LEADS_PUBLIC_PREFIX, AUDIOS_PUBLIC_PREFIX] as const

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
 * Multer options for attachments stored in `dir`: disk storage, unique
 * filenames, images + PDF only, capped size and count.
 */
function attachmentMulterOptions(
  dir: string,
  allowed: ReadonlySet<string> = ALLOWED_MIME,
  limits: { fileSize: number; files: number } = { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
) {
  return {
    storage: diskStorage({
      destination: (_req: Request, _file: MulterFile, cb: (error: Error | null, destination: string) => void) => {
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true })
        }
        cb(null, dir)
      },
      filename: (_req: Request, file: MulterFile, cb: FilenameCallback) => {
        cb(null, buildFilename(file))
      },
    }),
    fileFilter: (_req: Request, file: MulterFile, cb: FileFilterCallback) => {
      if (!allowed.has(file.mimetype)) {
        cb(new BadRequestException(`Tipo de archivo no permitido: ${file.mimetype}`), false)
        return
      }
      cb(null, true)
    },
    limits,
  }
}

/** Claim photos: uploads/siniestros. */
export const siniestroMulterOptions = attachmentMulterOptions(SINIESTROS_UPLOAD_DIR)

/** Documents for a quote a customer wants to take out: uploads/leads. */
export const leadMulterOptions = attachmentMulterOptions(LEADS_UPLOAD_DIR)

// Formats WhatsApp delivers voice notes and audio files in. 16 MB is
// WhatsApp's own limit for audio.
const AUDIO_MIME = new Set(['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr', 'audio/webm'])
export const MAX_AUDIO_SIZE = 16 * 1024 * 1024

/** A WhatsApp voice note, one per request: uploads/audios. */
export const audioMulterOptions = attachmentMulterOptions(AUDIOS_UPLOAD_DIR, AUDIO_MIME, {
  fileSize: MAX_AUDIO_SIZE,
  files: 1,
})

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

/** Longest side of a stored photo: enough to read a license or a vehicle card. */
const MAX_IMAGE_SIDE = 1280
const WEBP_QUALITY = 70
const CONVERTIBLE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic'])

const logger = new Logger('SiniestroUpload')

/**
 * Re-encodes an uploaded photo as WebP, at most MAX_IMAGE_SIDE px: about half
 * the size of a WhatsApp JPEG and a fraction of a camera original. `rotate()`
 * applies the EXIF orientation, and the output carries no EXIF at all — the
 * GPS location of the photo is dropped too. PDFs pass through untouched; a
 * photo sharp can't decode (e.g. HEIC without libheif) is kept as uploaded.
 */
export async function optimizeImage(file: MulterFile): Promise<MulterFile> {
  if (!CONVERTIBLE_MIME.has(file.mimetype)) return file

  const name = `${basename(file.filename, extname(file.filename))}.webp`
  const target = join(dirname(file.path), name)
  // Writing straight onto the source (a .webp upload) would clobber the input.
  const output = target === file.path ? `${target}.tmp` : target
  try {
    const info = await sharp(file.path)
      .rotate()
      .resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toFile(output)
    if (output === target) await unlink(file.path)
    else await rename(output, target)
    return {
      ...file,
      filename: name,
      path: target,
      mimetype: 'image/webp',
      size: info.size,
      originalname: `${basename(file.originalname, extname(file.originalname))}.webp`,
    }
  } catch (error) {
    await unlink(output).catch(() => undefined)
    logger.warn(`Could not convert ${file.filename} to WebP, keeping the original: ${(error as Error).message}`)
    return file
  }
}

/** Optimizes each upload (one at a time, to bound memory) and builds its metadata. */
export async function toStoredAdjuntos(
  files: MulterFile[],
  tipo?: string,
  publicPrefix: string = SINIESTROS_PUBLIC_PREFIX,
): Promise<AdjuntoMeta[]> {
  const stored: AdjuntoMeta[] = []
  for (const file of files) stored.push(toAdjuntoMeta(await optimizeImage(file), tipo, publicPrefix))
  return stored
}

export function toAdjuntoMeta(
  file: MulterFile,
  tipo?: string,
  publicPrefix: string = SINIESTROS_PUBLIC_PREFIX,
): AdjuntoMeta {
  return {
    filename: file.filename,
    originalName: file.originalname,
    url: `${publicPrefix}/${file.filename}`,
    mimeType: file.mimetype,
    size: file.size,
    ...(tipo ? { tipo } : {}),
  }
}
