import 'server-only'
import { z } from 'zod'
import { accountDb, currentUser } from './auth'
import { decryptKey, encryptKey, encryptionConfigured, type KeyKind } from './key-crypto'
import type { UserKey } from '@/lib/storage/userKey'
import type { VoiceKey } from '@/lib/storage/voiceKey'
import { USER_KEY_PROVIDERS } from '@/lib/providers'
import { userVoiceFromHeaders } from '@/lib/voice/user-voice'

const secret = z.string().min(1).max(4096).regex(/^[\x21-\x7e]+$/)
export const AIKey = z.object({ provider: z.enum(USER_KEY_PROVIDERS), key: secret, model: z.string().max(120).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/@+\-]*$/).optional() }).strict().refine(value => ['anthropic','deepseek'].includes(value.provider) || Boolean(value.model), 'A model is required.')
export const VoiceCredential = z.object({ provider: z.enum(['fish','elevenlabs']), key: secret, model: z.string().max(120).regex(/^[A-Za-z0-9_.-]+$/).optional(), voiceId: z.string().max(120).regex(/^[A-Za-z0-9_-]+$/).optional() }).strict().refine(value => value.provider !== 'elevenlabs' || Boolean(value.voiceId), 'A voice ID is required.')
export type Credential = UserKey | VoiceKey
export function parseCredential(kind: KeyKind, value: unknown): Credential { return (kind === 'ai' ? AIKey : VoiceCredential).parse(value) }
export const credentialMetadata = (kind: KeyKind, value: Credential) => ({ provider: value.provider, model: value.model, ...(kind === 'voice' ? { voiceId: (value as VoiceKey).voiceId } : {}), saved: true as const })

export async function readSavedKey(userId: string, kind: KeyKind): Promise<Credential | null> {
 if (!encryptionConfigured()) throw new Error('Saved keys are not configured.')
 const { data, error } = await accountDb().from('loci_provider_keys').select('ciphertext').eq('user_id', userId).eq('kind', kind).maybeSingle()
 if (error) throw new Error('Could not load your saved key. Try again.')
 return data ? parseCredential(kind, decryptKey(data.ciphertext, userId, kind)) : null
}
export async function writeSavedKey(userId: string, kind: KeyKind, credential: Credential) {
 const value = parseCredential(kind, credential)
 const { error } = await accountDb().from('loci_provider_keys').upsert({ user_id: userId, kind, ciphertext: encryptKey(value, userId, kind), updated_at: new Date().toISOString() }, { onConflict: 'user_id,kind' })
 if (error) throw new Error('Could not save your key. Try again.')
 return credentialMetadata(kind, value)
}
export async function deleteSavedKey(userId: string, kind: KeyKind) {
 const { error } = await accountDb().from('loci_provider_keys').delete().eq('user_id', userId).eq('kind', kind)
 if (error) throw new Error('Could not remove your saved key. Try again.')
}
async function requestedSavedKey(req: Request, kind: KeyKind) {
 if (req.headers.get(`x-loci-saved-${kind}`) !== '1') return null
 const user = await currentUser()
 if (!user) throw new Error('Sign in again to use your saved key.')
 const value = await readSavedKey(user.id, kind)
 if (!value) throw new Error('Your saved key was removed. Choose a key in API key settings.')
 return value
}
export async function resolveAIKey(req: Request): Promise<UserKey | null> {
 // An explicit page-only key takes precedence over a remembered key.
 if (req.headers.has('x-loci-key') || req.headers.has('x-loci-provider') || req.headers.has('x-loci-model')) {
  return AIKey.parse({ key: req.headers.get('x-loci-key'), provider: req.headers.get('x-loci-provider'), model: req.headers.get('x-loci-model') || undefined })
 }
 return await requestedSavedKey(req, 'ai') as UserKey | null
}
export async function resolveVoiceKey(req: Request) {
 const direct = userVoiceFromHeaders(req.headers)
 if (direct) return direct
 const saved = await requestedSavedKey(req, 'voice') as VoiceKey | null
 return saved ? { ...saved, model: saved.model || (saved.provider === 'fish' ? 's2-pro' : 'eleven_flash_v2_5') } : null
}
