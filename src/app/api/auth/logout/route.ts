import { authClient, authConfigured } from '@/lib/server/auth'
import { refuseCrossOrigin } from '@/lib/server/request'
export async function POST(req: Request) {
	const refused = refuseCrossOrigin(req)
	if (refused) return refused
	if (authConfigured()) {
		const { error } = await (await authClient()).auth.signOut({ scope: 'local' })
		if (error) return Response.json({ error: 'Could not sign out. Try again.' }, { status: 503 })
	}
	return Response.json({ ok: true })
}
