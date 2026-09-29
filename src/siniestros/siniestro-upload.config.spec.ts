import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import sharp from 'sharp'
import { optimizeImage, toStoredAdjuntos } from './siniestro-upload.config'

describe('claim photo optimization', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'adjuntos-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  /** Writes a noisy photo-like image (flat colors would compress unrealistically well). */
  async function writePhoto(filename: string, width: number, height: number, format: 'jpeg' | 'png' | 'webp') {
    const noise = Buffer.alloc(width * height * 3)
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919) % 251
    const path = join(dir, filename)
    await sharp(noise, { raw: { width, height, channels: 3 } })
      .withMetadata({ exif: { IFD0: { Make: 'TestCam' } } })
      [format]({ quality: 95 })
      .toFile(path)
    return {
      fieldname: 'adjuntos',
      originalname: `foto-carnet.${format === 'jpeg' ? 'jpg' : format}`,
      filename,
      path,
      destination: dir,
      mimetype: `image/${format}`,
      size: statSync(path).size,
    } as Express.Multer.File
  }

  it('turns a large JPEG into a smaller WebP of at most 1280 px, without EXIF', async () => {
    const file = await writePhoto('1-1.jpg', 3000, 2000, 'jpeg')

    const out = await optimizeImage(file)

    expect(out.filename).toBe('1-1.webp')
    expect(out.mimetype).toBe('image/webp')
    expect(out.originalname).toBe('foto-carnet.webp')
    expect(out.size).toBeLessThan(file.size)
    expect(existsSync(file.path)).toBe(false)
    const meta = await sharp(out.path).metadata()
    expect(meta.format).toBe('webp')
    expect(Math.max(meta.width!, meta.height!)).toBe(1280)
    expect(meta.exif).toBeUndefined()
  })

  it('does not enlarge a small photo', async () => {
    const out = await optimizeImage(await writePhoto('2-2.png', 300, 200, 'png'))

    const meta = await sharp(out.path).metadata()
    expect([meta.width, meta.height]).toEqual([300, 200])
  })

  it('re-encodes a WebP upload in place', async () => {
    const out = await optimizeImage(await writePhoto('3-3.webp', 2000, 2000, 'webp'))

    expect(out.path).toBe(join(dir, '3-3.webp'))
    expect(existsSync(`${out.path}.tmp`)).toBe(false)
    // Read the bytes: sharp caches decoded files by path, and this path was rewritten.
    expect((await sharp(readFileSync(out.path)).metadata()).width).toBe(1280)
  })

  it('keeps a PDF as uploaded', async () => {
    const path = join(dir, '4-4.pdf')
    writeFileSync(path, '%PDF-1.4 test')
    const file = { filename: '4-4.pdf', path, mimetype: 'application/pdf', size: 13 } as Express.Multer.File

    expect(await optimizeImage(file)).toBe(file)
    expect(existsSync(path)).toBe(true)
  })

  it('keeps a photo it cannot decode instead of failing the upload', async () => {
    const path = join(dir, '5-5.jpg')
    writeFileSync(path, 'not really a jpeg')
    const file = { filename: '5-5.jpg', path, mimetype: 'image/jpeg', size: 17 } as Express.Multer.File

    expect(await optimizeImage(file)).toBe(file)
    expect(existsSync(path)).toBe(true)
    expect(existsSync(join(dir, '5-5.webp'))).toBe(false)
  })

  it('builds the stored metadata with the WebP URL and the photo type', async () => {
    const [meta] = await toStoredAdjuntos([await writePhoto('6-6.jpg', 1600, 1200, 'jpeg')], 'carnet')

    expect(meta).toEqual(
      expect.objectContaining({
        filename: '6-6.webp',
        url: '/uploads/siniestros/6-6.webp',
        mimeType: 'image/webp',
        tipo: 'carnet',
      }),
    )
  })
})
