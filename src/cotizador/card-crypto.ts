import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// AES-256-GCM with a random IV per value; output is "iv.authTag.ciphertext" in base64.
// The key comes from CARD_ENCRYPTION_KEY (64 hex chars = 32 bytes) — generate one with `openssl rand -hex 32`.
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12

export const encryptCardNumber = (plain: string, key: Buffer): string => {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${encrypted.toString('base64')}`
}

export const decryptCardNumber = (payload: string, key: Buffer): string => {
  const [iv, authTag, data] = payload.split('.').map(part => Buffer.from(part, 'base64'))
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}
