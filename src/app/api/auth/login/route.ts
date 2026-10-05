import { deviceFor, ipHashFor } from '@/lib/server/device'
import { limitConfigFromEnv, takeUsage } from '@/lib/server/limits'
import { z } from 'zod'
import { authClient, authConfigured, appOrigin } from '@/lib/server/auth'
import { readLimitedJson, refuseCrossOrigin } from '@/lib/server/request'

const Body = z.discriminatedUnion('method', [z.object({ method: z.literal('email'), email: z.email().max(254) }), z.object({ method: z.literal('google') })])
export async function POST(req: Request) {
	const refused = refuseCrossOrigin(req)
	if (refused) return refused
	if (!authConfigured()) return Response.json({ error: 'Accounts are not available yet.' }, { status: 503 })
	const body = await readLimitedJson(req, 2048)
	if (body instanceof Response) return body
	const parsed = Body.safeParse(body.value)
	if (!parsed.success) return Response.json({ error: 'Enter a valid email address.' }, { status: 400 })
	const device = deviceFor(req)
	const respond = (body: object, status = 200) => {
		const response = Response.json(body, { status })
		if (device.setCookie) response.headers.append('Set-Cookie', device.setCookie)
		return response
	}
	try {
		if (limitConfigFromEnv().enabled) {
			const limit = await takeUsage('auth', { perDevice: 10, perIp: 30, global: 1000 }, device.id, ipHashFor(req))
			if (!limit.ok) return respond({ error: 'Too many sign-in attempts. Try again tomorrow.' }, 429)
		}
		const client = await authClient()
		const redirectTo = `${appOrigin(req)}/auth/callback`
		if (parsed.data.method === 'google') {
			const { data, error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } })
			if (error || !data.url) throw error ?? new Error('Missing sign-in URL')
			return respond({ url: data.url })
		}
		const { error } = await client.auth.signInWithOtp({ email: parsed.data.email, options: { emailRedirectTo: redirectTo } })
		if (error) throw error
		return respond({ sent: true })
	} catch (err) {
		console.error('[loci] sign-in failed:', err instanceof Error ? err.message : err)
		return respond({ error: 'Could not start sign-in. Please try again in a minute.' }, 503)
	}
}
