import { NextResponse, type NextRequest } from 'next/server'
import { STATS_REALM, statsAuthorized } from '@/lib/server/stats-auth'

/** Asks for the stats password before /admin/stats renders; the page checks it again. */
export function proxy(req: NextRequest) {
	if (!process.env.LOCI_STATS_PASSWORD) return new NextResponse('Not found.', { status: 404 })
	if (statsAuthorized(req.headers.get('authorization'))) return NextResponse.next()
	return new NextResponse('Sign in to see the stats.', {
		status: 401,
		headers: { 'WWW-Authenticate': `Basic realm="${STATS_REALM}", charset="UTF-8"`, 'Cache-Control': 'no-store' },
	})
}

export const config = { matcher: ['/admin/stats', '/admin/stats/:path*'] }
