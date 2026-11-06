import type { Request } from 'express'

/** Addresses the API sees when a request comes through nginx on the same server. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/** The panel's login: recorded even though nobody is logged in yet. */
export const LOGIN_PATH = '/auth/login'

/** Write methods: reads (and the panel's polling) are never recorded. */
export const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** "Seen" markers the panel sends on every visit: not changes, only noise. */
const SKIPPED_PATH = /\/visit$/

/**
 * The browser's address. nginx sets X-Real-IP to the address it received the
 * request from (overwriting whatever the browser sent), so the header is
 * trusted only when the request reached the API through nginx on this machine.
 */
export function clientIp(req: Pick<Request, 'headers' | 'socket'>): string {
  const socket = req.socket?.remoteAddress ?? ''
  const forwarded = req.headers['x-real-ip']
  const viaProxy = LOOPBACK.has(socket) && typeof forwarded === 'string' && forwarded.trim() !== ''
  const ip = viaProxy ? (forwarded as string).trim() : socket
  return ip.replace(/^::ffff:/, '').slice(0, 45) || 'unknown'
}

/** The URL without its query string. */
export function requestPath(req: Pick<Request, 'originalUrl' | 'url'>): string {
  return (req.originalUrl || req.url || '').split('?')[0].slice(0, 255)
}

/** Whether a finished write request is one worth keeping. */
export function isRecordable(path: string, userType: string | undefined): boolean {
  if (SKIPPED_PATH.test(path)) return false
  return path === LOGIN_PATH || userType === 'user'
}

/** The names of the fields sent ("name,password"), never their values. */
export function fieldNames(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const names = Object.keys(body).join(',')
  return names ? names.slice(0, 255) : null
}
