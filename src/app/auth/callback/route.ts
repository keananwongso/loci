import { authClient, appOrigin } from '@/lib/server/auth'

export async function GET(req: Request) {
	const url = new URL(req.url)
	try {
		const client = await authClient()
		const code = url.searchParams.get('code')
		const hash = url.searchParams.get('token_hash')
		const result = code ? await client.auth.exchangeCodeForSession(code) : hash ? await client.auth.verifyOtp({ token_hash: hash, type: 'email' }) : null
		if (result && !result.error) return Response.redirect(`${appOrigin(req)}/account`, 303)
	} catch (err) { console.error('[loci] auth callback failed:', err instanceof Error ? err.message : err) }
	return Response.redirect(new URL('/account?error=sign-in', req.url), 303)
}
