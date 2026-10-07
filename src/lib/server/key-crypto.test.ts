import { afterEach, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { decryptKey, encryptKey } from './key-crypto'
afterEach(() => vi.unstubAllEnvs())
const configure = () => vi.stubEnv('LOCI_KEY_ENCRYPTION_SECRET', randomBytes(32).toString('base64'))
it('encrypts all credentials and settings with randomized authenticated ciphertext', () => {
 configure()
 const value = { provider: 'deepseek', key: 'test-private-key', model: 'model' }
 const first = encryptKey(value, 'user-a', 'ai'), second = encryptKey(value, 'user-a', 'ai')
 expect(first).not.toContain(value.key); expect(first).not.toContain('deepseek'); expect(first).not.toBe(second)
 expect(decryptKey(first, 'user-a', 'ai')).toEqual(value)
})
it('rejects another account, another kind, tampering and a wrong encryption secret', () => {
 configure(); const encrypted = encryptKey({ key: 'secret' }, 'user-a', 'ai')
 expect(() => decryptKey(encrypted, 'user-b', 'ai')).toThrow('Could not unlock')
 expect(() => decryptKey(encrypted, 'user-a', 'voice')).toThrow('Could not unlock')
 const chunks = encrypted.split('.'); chunks[2] = randomBytes(16).toString('base64')
 expect(() => decryptKey(chunks.join('.'), 'user-a', 'ai')).toThrow('Could not unlock')
 configure(); expect(() => decryptKey(encrypted, 'user-a', 'ai')).toThrow('Could not unlock')
})
it('refuses persistence when a proper encryption secret is absent', () => {
 vi.stubEnv('LOCI_KEY_ENCRYPTION_SECRET', '')
 expect(() => encryptKey({}, 'user-a', 'voice')).toThrow('not configured')
})
