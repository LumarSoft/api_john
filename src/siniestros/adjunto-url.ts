import { createHmac, timingSafeEqual } from 'crypto'
import type { NextFunction, Request, Response } from 'express'
import { SINIESTROS_PUBLIC_PREFIX } from './siniestro-upload.config'

/**
 * Claim photos are driver's licenses and vehicle cards, served as static files.
 * Instead of a public URL, every URL the API hands out carries an expiring
 * HMAC signature, checked before the file is served. The panel keeps working
 * unchanged: it renders whatever URL the API returns.
 */

/** How long a signed URL stays valid. */
const TTL_SECONDS = 12 * 60 * 60
/** Expiry is snapped to this step so a photo keeps the same URL for a while
 * and the browser can cache it across page loads. */
const EXPIRY_STEP_SECONDS = 60 * 60

function signingKey(): Buffer {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is required to sign attachment URLs')
  // Derived key: a URL signature can never double as anything signed with JWT_SECRET.
  return createHmac('sha256', secret).update('siniestro-adjuntos-v1').digest()
}

function signature(path: string, exp: number): string {
  return createHmac('sha256', signingKey()).update(`${path}\n${exp}`).digest('base64url')
}

/** Returns the URL with `?exp=…&sig=…`. URLs outside the claims folder are left as they are. */
export function signAdjuntoUrl(url: string, now = Date.now()): string {
  const path = url.split('?')[0]
  if (!path.startsWith(`${SINIESTROS_PUBLIC_PREFIX}/`)) return url
  const exp = Math.ceil(now / 1000 / EXPIRY_STEP_SECONDS) * EXPIRY_STEP_SECONDS + TTL_SECONDS
  return `${path}?exp=${exp}&sig=${signature(path, exp)}`
}

export function isValidAdjuntoSignature(path: string, exp: unknown, sig: unknown, now = Date.now()): boolean {
  const expiry = Number(exp)
  if (!Number.isInteger(expiry) || expiry * 1000 < now || typeof sig !== 'string') return false
  const expected = Buffer.from(signature(path, expiry))
  const given = Buffer.from(sig)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/** Signs the `url` of every attachment in a siniestro row returned to a client. */
export function withSignedAdjuntos<T extends { adjuntos: unknown }>(row: T): T {
  if (!Array.isArray(row.adjuntos)) return row
  const adjuntos: unknown[] = row.adjuntos.map((adjunto: unknown) => {
    if (!adjunto || typeof adjunto !== 'object') return adjunto
    const { url } = adjunto as { url?: unknown }
    return typeof url === 'string' ? { ...adjunto, url: signAdjuntoUrl(url) } : adjunto
  })
  return { ...row, adjuntos }
}

/** Express middleware mounted on the claims folder: no valid signature, no file. */
export function requireSignedAdjunto(req: Request, res: Response, next: NextFunction): void {
  const path = `${SINIESTROS_PUBLIC_PREFIX}${req.path}`
  if (isValidAdjuntoSignature(path, req.query.exp, req.query.sig)) {
    next()
    return
  }
  res.status(403).end()
}
