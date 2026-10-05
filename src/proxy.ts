import { NextResponse, type NextRequest } from 'next/server'
import { ipHashFor } from '@/lib/server/device'
import { statsLoginAttempt } from '@/lib/server/stats-login'
import { STATS_REALM, statsAuthorized } from '@/lib/server/stats-auth'

/** Asks for the stats password before /admin/stats renders; the page checks it again. */
export async function proxy(req: NextRequest) {
	if (!process.env.LOCI_STATS_PASSWORD) return new NextResponse('Not found.', { status: 404 })
	const authorization = req.headers.get('authorization')
	if (authorization) {
		const attempt = await statsLoginAttempt(ipHashFor(req), () => statsAuthorized(authorization)).catch((err) => {
			// Fail closed: without the counter store, guesses can't be limited.
			console.error('[loci] stats sign-in check failed:', err instanceof Error ? err.message : err)
			return null
		})
		if (!attempt || !attempt.allowed)
			return new NextResponse('Too many sign-in attempts. Try again tomorrow.', { status: 429, headers: { 'Cache-Control': 'no-store' } })
		if (attempt.ok) return NextResponse.next()
	}
	return new NextResponse('Sign in to see the stats.', {
		status: 401,
		headers: { 'WWW-Authenticate': `Basic realm="${STATS_REALM}", charset="UTF-8"`, 'Cache-Control': 'no-store' },
	})
}

export const config = { matcher: ['/admin/stats', '/admin/stats/:path*'] }
