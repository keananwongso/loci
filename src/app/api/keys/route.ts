import { authConfigured, currentUser } from '@/lib/server/auth'
import { encryptionConfigured, type KeyKind } from '@/lib/server/key-crypto'
import { credentialMetadata, readSavedKey, writeSavedKey, deleteSavedKey, parseCredential } from '@/lib/server/provider-keys'
import { readLimitedJson, refuseCrossOrigin } from '@/lib/server/request'
import { z } from 'zod'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store, private' } })
export async function GET() {
 try {
  const user = authConfigured() ? await currentUser() : null
  const available = encryptionConfigured()
  if (!user || !available) return json({ signedIn: Boolean(user), available, keys: {} })
  const keys: Partial<Record<KeyKind, unknown>> = {}
  for (const kind of ['ai','voice'] as const) { const value = await readSavedKey(user.id, kind); if (value) keys[kind] = credentialMetadata(kind, value) }
  return json({ signedIn: true, available: true, keys })
 } catch { return json({ error: 'Could not load saved key settings. Try again.' }, 503) }
}
const Input = z.object({ kind: z.enum(['ai','voice']), credential: z.unknown().optional() }).strict()
async function mutate(req: Request, remove: boolean) {
 const origin = refuseCrossOrigin(req)
 if (origin) return origin
 try {
  const user = await currentUser()
  if (!user) return json({ error: 'Sign in to remember keys.' }, 401)
  if (!remove && !encryptionConfigured()) return json({ error: 'Remembering keys is not available yet.' }, 503)
  const body = await readLimitedJson(req, 12 * 1024)
  if (body instanceof Response) return body
  const parsed = Input.safeParse(body.value)
  if (!parsed.success) return json({ error: 'Invalid key settings.' }, 400)
  const { kind } = parsed.data
  if (remove) { await deleteSavedKey(user.id, kind); return json({ ok: true }) }
  let credential = parsed.data.credential
  // A blank key updates settings on the existing account key without exposing it to the client.
  if (credential && typeof credential === 'object' && !('key' in credential && credential.key)) {
   const previous = await readSavedKey(user.id, kind)
   if (!previous || !('provider' in credential) || credential.provider !== previous.provider) return json({ error: 'Enter a key for this provider.' }, 400)
   credential = { ...credential, key: previous.key }
  }
  try { credential = parseCredential(kind, credential) } catch { return json({ error: 'Invalid provider, key, model or voice ID.' }, 400) }
  const metadata = await writeSavedKey(user.id, kind, credential as Parameters<typeof writeSavedKey>[2])
  return json({ kind, metadata })
 } catch { return json({ error: remove ? 'Could not remove your saved key. Try again.' : 'Could not save your key. Try again.' }, 503) }
}
export const PUT = (req: Request) => mutate(req, false)
export const DELETE = (req: Request) => mutate(req, true)
