import { appOrigin, currentUser } from '@/lib/server/auth'
import { billingConfigured, readSubscription, stripeClient } from '@/lib/server/billing'
import { refuseCrossOrigin } from '@/lib/server/request'
export async function POST(req: Request) {
	const refused = refuseCrossOrigin(req)
	if (refused) return refused
	if (!billingConfigured()) return Response.json({ error: 'Billing is not available yet.' }, { status: 503 })
	try {
		const user = await currentUser()
		if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 })
		const subscription = await readSubscription(user.id)
		if (!subscription) return Response.json({ error: 'No subscription to manage.' }, { status: 404 })
		const session = await stripeClient().billingPortal.sessions.create({ customer: subscription.stripe_customer_id, return_url: `${appOrigin(req)}/account` })
		return Response.json({ url: session.url })
	} catch (err) {
		console.error('[loci] billing portal failed:', err instanceof Error ? err.message : err)
		return Response.json({ error: 'Could not open billing. Please try again.' }, { status: 503 })
	}
}
