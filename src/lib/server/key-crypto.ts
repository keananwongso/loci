import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export type KeyKind = 'ai' | 'voice'
export function encryptionConfigured() { return /^[A-Za-z0-9+/]{43}=$/.test(process.env.LOCI_KEY_ENCRYPTION_SECRET || '') }
function encryptionKey() {
 if (!encryptionConfigured()) throw new Error('Saved keys are not configured.')
 return Buffer.from(process.env.LOCI_KEY_ENCRYPTION_SECRET!, 'base64')
}
const context = (userId: string, kind: KeyKind) => Buffer.from(JSON.stringify(['loci-provider-key', 1, userId, kind]))

/** GCM authenticates both the payload and its account/kind; copied rows cannot be decrypted. */
export function encryptKey(value: unknown, userId: string, kind: KeyKind): string {
 const iv = randomBytes(12)
 const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
 cipher.setAAD(context(userId, kind))
 const payload = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
 return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), payload.toString('base64')].join('.')
}
export function decryptKey(ciphertext: string, userId: string, kind: KeyKind): unknown {
 try {
  const [version, iv, tag, data, extra] = ciphertext.split('.')
  if (version !== 'v1' || extra || !iv || !tag || !data) throw new Error()
  const nonce = Buffer.from(iv, 'base64'), authTag = Buffer.from(tag, 'base64')
  if (nonce.length !== 12 || authTag.length !== 16) throw new Error()
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), nonce)
  decipher.setAAD(context(userId, kind)); decipher.setAuthTag(authTag)
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8'))
 } catch { throw new Error('Could not unlock the saved key. Replace it in API key settings.') }
}
