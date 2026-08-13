import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * AES-256-GCM for secrets we must be able to read back (as opposed to hashes).
 * Output format is "iv.authTag.ciphertext", all base64 — same shape the cotizador
 * uses for card numbers, so both are readable by the same eyes.
 *
 * The key is 32 bytes given as 64 hex chars. Generate one with:
 *   openssl rand -hex 32
 */
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12

export function resolveKey(hex: string | undefined, envName: string): Buffer {
  if (!hex) throw new Error(`${envName} is not set — cannot encrypt or decrypt secrets`)
  const key = Buffer.from(hex, 'hex')
  if (key.length !== 32) throw new Error(`${envName} must be 64 hex characters (32 bytes)`)
  return key
}

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${encrypted.toString('base64')}`
}

export function decryptSecret(payload: string, key: Buffer): string {
  const [iv, authTag, data] = payload.split('.').map(part => Buffer.from(part, 'base64'))
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}
