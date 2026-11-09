import { BadRequestException, NotFoundException } from '@nestjs/common'
import { existsSync } from 'fs'
import { mkdir, readdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import sharp from 'sharp'
import type { PrismaService } from '../prisma/prisma.service'
import { LOGOS_UPLOAD_DIR, OrganizationLogoService } from './organization-logo.service'

jest.mock('fs/promises', () => {
  const actual = jest.requireActual<typeof import('fs/promises')>('fs/promises')
  return { ...actual, writeFile: jest.fn(actual.writeFile), unlink: jest.fn(actual.unlink) }
})

/** An organization id no real database has: the test only ever removes its own files. */
const ORG = 987654

afterAll(async () => {
  const files = await readdir(LOGOS_UPLOAD_DIR).catch(() => [] as string[])
  await Promise.all(
    files.filter(f => f.startsWith(`org-${ORG}-`)).map(f => rm(join(LOGOS_UPLOAD_DIR, f), { force: true })),
  )
})

function setup(logoUrl: string | null = null) {
  const prisma = {
    producer: {
      findFirst: jest.fn().mockResolvedValue({ logoUrl }),
      update: jest.fn().mockResolvedValue({}),
    },
  }
  return { prisma, service: new OrganizationLogoService(prisma as unknown as PrismaService) }
}

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 4, background: { r: 31, g: 79, b: 224, alpha: 1 } } })
    .png()
    .toBuffer()

describe('organization logo', () => {
  it('stores a square WebP and points the organization at it', async () => {
    const { service, prisma } = setup()
    const { logoUrl } = await service.save(ORG, { buffer: await png(600, 300), mimetype: 'image/png' })
    expect(logoUrl).toMatch(new RegExp(`^/uploads/logos/org-${ORG}-\\d+\\.webp$`))
    expect(prisma.producer.update).toHaveBeenCalledWith({ where: { id: ORG }, data: { logoUrl } })
    const file = join(LOGOS_UPLOAD_DIR, logoUrl.split('/').pop()!)
    const meta = await sharp(file).metadata()
    expect(meta).toMatchObject({ format: 'webp', width: 256, height: 256 })
  })

  it('removes the logo it replaces', async () => {
    await mkdir(LOGOS_UPLOAD_DIR, { recursive: true })
    const old = join(LOGOS_UPLOAD_DIR, 'org-987654-1.webp')
    await writeFile(old, 'old')
    const { service } = setup('/uploads/logos/org-987654-1.webp')
    await service.save(ORG, { buffer: await png(64, 64), mimetype: 'image/png' })
    expect(existsSync(old)).toBe(false)
  })

  it('refuses SVG and anything that is not an image', async () => {
    const { service, prisma } = setup()
    await expect(service.save(ORG, { buffer: Buffer.from('<svg/>'), mimetype: 'image/svg+xml' })).rejects.toThrow(
      BadRequestException,
    )
    await expect(service.save(ORG, { buffer: Buffer.from('not an image'), mimetype: 'image/png' })).rejects.toThrow(
      'No se pudo leer la imagen',
    )
    await expect(service.save(ORG, undefined)).rejects.toThrow('Falta la imagen')
    expect(prisma.producer.update).not.toHaveBeenCalled()
  })

  it('goes back to the initials, and never touches a file outside the logos folder', async () => {
    const { service, prisma } = setup('/uploads/siniestros/../../.env')
    await expect(service.remove(ORG)).resolves.toEqual({ logoUrl: null })
    expect(prisma.producer.update).toHaveBeenCalledWith({ where: { id: ORG }, data: { logoUrl: null } })
    const { unlink } = jest.requireMock<typeof import('fs/promises')>('fs/promises')
    expect(unlink).not.toHaveBeenCalledWith(expect.stringContaining('.env'))
  })

  it('answers 404 for an organization that is not there', async () => {
    const { service, prisma } = setup()
    prisma.producer.findFirst.mockResolvedValue(null)
    await expect(service.remove(99)).rejects.toThrow(NotFoundException)
  })
})
