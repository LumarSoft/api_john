import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { mkdir, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import sharp from 'sharp'
import { PrismaService } from '../prisma/prisma.service'

export const LOGOS_UPLOAD_DIR = join(process.cwd(), 'uploads', 'logos')
export const LOGOS_PUBLIC_PREFIX = '/uploads/logos'

/** PNG, JPEG or WebP. SVG is refused: it can carry scripts and is served from the API's domain. */
export const LOGO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
export const MAX_LOGO_SIZE = 2 * 1024 * 1024

/** Side of the stored square: sharp enough for the sidebar, the login and the printed card. */
const LOGO_SIDE = 256

/**
 * The organization's logo. An upload is turned into a square WebP (the image
 * fitted inside, transparent around it) under uploads/logos, and the previous
 * file is removed. Logos are public branding, so they are served as they are.
 */
@Injectable()
export class OrganizationLogoService {
  private readonly logger = new Logger(OrganizationLogoService.name)

  constructor(private readonly prisma: PrismaService) {}

  async save(producerId: number, file: { buffer: Buffer; mimetype: string } | undefined): Promise<{ logoUrl: string }> {
    if (!file) throw new BadRequestException('Falta la imagen del logo.')
    if (!LOGO_MIME_TYPES.has(file.mimetype)) throw new BadRequestException('El logo tiene que ser PNG, JPG o WebP.')
    const previous = await this.currentLogo(producerId)

    let image: Buffer
    try {
      image = await sharp(file.buffer)
        .resize(LOGO_SIDE, LOGO_SIDE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality: 90 })
        .toBuffer()
    } catch {
      throw new BadRequestException('No se pudo leer la imagen del logo.')
    }

    await mkdir(LOGOS_UPLOAD_DIR, { recursive: true })
    const filename = `org-${producerId}-${Date.now()}.webp`
    await writeFile(join(LOGOS_UPLOAD_DIR, filename), image)
    const logoUrl = `${LOGOS_PUBLIC_PREFIX}/${filename}`
    await this.prisma.producer.update({ where: { id: producerId }, data: { logoUrl } })
    await this.removeFile(previous)
    return { logoUrl }
  }

  async remove(producerId: number): Promise<{ logoUrl: null }> {
    const previous = await this.currentLogo(producerId)
    await this.prisma.producer.update({ where: { id: producerId }, data: { logoUrl: null } })
    await this.removeFile(previous)
    return { logoUrl: null }
  }

  private async currentLogo(producerId: number): Promise<string | null> {
    const producer = await this.prisma.producer.findFirst({
      where: { id: producerId, deletedAt: null },
      select: { logoUrl: true },
    })
    if (!producer) throw new NotFoundException(`Organization ${producerId} not found`)
    return producer.logoUrl
  }

  /** The replaced file goes; a file that is already gone is fine. */
  private async removeFile(logoUrl: string | null): Promise<void> {
    if (!logoUrl?.startsWith(`${LOGOS_PUBLIC_PREFIX}/`)) return
    const filename = logoUrl.slice(LOGOS_PUBLIC_PREFIX.length + 1)
    if (!/^[\w.-]+$/.test(filename)) return
    try {
      await unlink(join(LOGOS_UPLOAD_DIR, filename))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
        this.logger.warn(`Could not remove the old logo ${filename}: ${(err as Error).message}`)
    }
  }
}
