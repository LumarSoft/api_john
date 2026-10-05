import type { NextFunction, Request, Response } from 'express'
import { isValidAdjuntoSignature, requireSignedAdjunto, signAdjuntoUrl, withSignedAdjuntos } from './adjunto-url'

describe('signed attachment URLs', () => {
  const now = Date.UTC(2026, 8, 28, 21, 30)
  const path = '/uploads/siniestros/1789688390051-780851029.webp'

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  function parts(url: string) {
    const [p, query] = url.split('?')
    const params = new URLSearchParams(query)
    return { path: p, exp: params.get('exp'), sig: params.get('sig') }
  }

  it('signs a claim photo URL that then verifies', () => {
    const signed = parts(signAdjuntoUrl(path, now))

    expect(signed.path).toBe(path)
    expect(isValidAdjuntoSignature(signed.path, signed.exp, signed.sig, now)).toBe(true)
  })

  it('protects stored voice notes like claim photos', () => {
    const audio = '/uploads/audios/1791230000000-123.ogg'
    const signed = parts(signAdjuntoUrl(audio, now))

    expect(signed.sig).toBeTruthy()
    expect(isValidAdjuntoSignature(signed.path, signed.exp, signed.sig, now)).toBe(true)
  })

  it('keeps the same URL within the hour so the browser can cache it', () => {
    expect(signAdjuntoUrl(path, now)).toBe(signAdjuntoUrl(path, now + 10 * 60 * 1000))
  })

  it('rejects another file, a changed expiry, a forged or missing signature', () => {
    const { exp, sig } = parts(signAdjuntoUrl(path, now))

    expect(isValidAdjuntoSignature('/uploads/siniestros/other.webp', exp, sig, now)).toBe(false)
    expect(isValidAdjuntoSignature(path, String(Number(exp) + 3600), sig, now)).toBe(false)
    expect(isValidAdjuntoSignature(path, exp, 'forged', now)).toBe(false)
    expect(isValidAdjuntoSignature(path, undefined, undefined, now)).toBe(false)
  })

  it('rejects a signature once it expires (after at most 13 h)', () => {
    const { exp, sig } = parts(signAdjuntoUrl(path, now))

    expect(isValidAdjuntoSignature(path, exp, sig, now + 12 * 3600 * 1000)).toBe(true)
    expect(isValidAdjuntoSignature(path, exp, sig, now + 13 * 3600 * 1000 + 1)).toBe(false)
  })

  it('rejects a signature made with another secret', () => {
    const { exp, sig } = parts(signAdjuntoUrl(path, now))
    process.env.JWT_SECRET = 'rotated-secret'
    try {
      expect(isValidAdjuntoSignature(path, exp, sig, now)).toBe(false)
    } finally {
      process.env.JWT_SECRET = 'test-secret'
    }
  })

  it('leaves URLs outside the claims folder untouched', () => {
    expect(signAdjuntoUrl('https://example.com/a.png', now)).toBe('https://example.com/a.png')
  })

  it('signs every attachment of a row and leaves the rest of the row alone', () => {
    const row = {
      id: 3,
      adjuntos: [
        { filename: 'a.webp', url: '/uploads/siniestros/a.webp', mimeType: 'image/webp' },
        { filename: 'b.pdf', url: '/uploads/siniestros/b.pdf', mimeType: 'application/pdf' },
      ],
    }

    const signed = withSignedAdjuntos(row)
    const adjuntos = signed.adjuntos as { url: string; filename: string }[]

    expect(signed.id).toBe(3)
    expect(adjuntos.map(a => a.filename)).toEqual(['a.webp', 'b.pdf'])
    expect(adjuntos.every(a => /\?exp=\d+&sig=/.test(a.url))).toBe(true)
    // The stored row is not mutated.
    expect(row.adjuntos[0].url).toBe('/uploads/siniestros/a.webp')
  })

  it('handles rows without attachments', () => {
    expect(withSignedAdjuntos({ adjuntos: null })).toEqual({ adjuntos: null })
  })

  describe('requireSignedAdjunto middleware', () => {
    function run(url: string) {
      const [p, query] = url.split('?')
      const base = p.startsWith('/uploads/leads') ? '/uploads/leads' : '/uploads/siniestros'
      const req = {
        baseUrl: base,
        path: p.replace(base, ''),
        query: Object.fromEntries(new URLSearchParams(query ?? '')),
      } as unknown as Request
      const end = jest.fn()
      const res = { status: jest.fn().mockReturnValue({ end }) } as unknown as Response
      const next = jest.fn() as NextFunction
      requireSignedAdjunto(req, res, next)
      return { next, status: res.status as jest.Mock }
    }

    it('serves a signed URL', () => {
      const { next, status } = run(signAdjuntoUrl(path))

      expect(next).toHaveBeenCalled()
      expect(status).not.toHaveBeenCalled()
    })

    it('protects the take-out documents folder too', () => {
      const lead = '/uploads/leads/1-1.webp'
      expect(run(lead).status).toHaveBeenCalledWith(403)
      expect(run(signAdjuntoUrl(lead)).next).toHaveBeenCalled()
    })

    it('answers 403 to a bare URL', () => {
      const { next, status } = run(path)

      expect(next).not.toHaveBeenCalled()
      expect(status).toHaveBeenCalledWith(403)
    })
  })
})
