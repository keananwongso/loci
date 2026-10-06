import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { authClient, googleClientId } from '@/lib/server/auth'
import { deviceFor, ipHashFor } from '@/lib/server/device'
import { limitConfigFromEnv, takeUsage } from '@/lib/server/limits'
import { readLimitedJson, refuseCrossOrigin } from '@/lib/server/request'

/**
 * Sign in with Google's own button, so the consent screen names this site rather than the
 * Supabase project. Google signs an ID token in a popup; Supabase verifies it server-side.
 */
const NONCE_COOKIE = 'loci-google-nonce'
const cookie = (value: string, maxAge: number) =>
	`${NONCE_COOKIE}=${value}; Path=/api/auth/google; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
const hash = (nonce: string) => createHash('sha256').update(nonce).digest('hex')

/** A fresh nonce per sign-in: Google embeds its hash in the token, Supabase checks it against the raw value. */
export async function GET() {
	const clientId = googleClientId()
	if (!clientId) return Response.json({ error: 'Google sign-in is not available yet.' }, { status: 503 })
	const nonce = randomBytes(32).toString('base64url')
	return Response.json({ clientId, nonce: hash(nonce) }, { headers: { 'Set-Cookie': cookie(nonce, 600), 'Cache-Control': 'no-store' } })
}

const Body = z.object({ credential: z.string().min(1).max(8192) })
export async function POST(req: Request) {
	const refused = refuseCrossOrigin(req)
	if (refused) return refused
	if (!googleClientId()) return Response.json({ error: 'Google sign-in is not available yet.' }, { status: 503 })
	const body = await readLimitedJson(req, 16384)
	if (body instanceof Response) return body
	const parsed = Body.safeParse(body.value)
	if (!parsed.success) return Response.json({ error: 'Google sign-in failed. Try again.' }, { status: 400 })
	const nonce = req.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${NONCE_COOKIE}=([\\w-]+)`))?.[1]
	if (!nonce) return Response.json({ error: 'Sign-in expired. Try again.' }, { status: 400 })
	const device = deviceFor(req)
	const respond = (body: object, status = 200) => {
		const response = Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
		response.headers.append('Set-Cookie', cookie('', 0))
		if (device.setCookie) response.headers.append('Set-Cookie', device.setCookie)
		return response
	}
	try {
		if (limitConfigFromEnv().enabled) {
			const limit = await takeUsage('auth', { perDevice: 10, perIp: 30, global: 1000 }, device.id, ipHashFor(req))
			if (!limit.ok) return respond({ error: 'Too many sign-in attempts. Try again tomorrow.' }, 429)
		}
		const { error } = await (await authClient()).auth.signInWithIdToken({ provider: 'google', token: parsed.data.credential, nonce })
		if (error) {
			console.error('[loci] Google sign-in rejected:', error.message)
			return respond({ error: 'Google sign-in could not be verified. Try again.' }, 401)
		}
		return respond({ ok: true })
	} catch (err) {
		console.error('[loci] Google sign-in failed:', err instanceof Error ? err.message : err)
		return respond({ error: 'Could not sign in. Please try again in a minute.' }, 503)
	}
}
