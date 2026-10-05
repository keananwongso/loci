import { authConfigured, currentUser } from '@/lib/server/auth'
import { billingConfigured, readSubscription, syncCustomer, subscriptionActive } from '@/lib/server/billing'
import { paidQuota, paidLimits } from '@/lib/server/paid-usage'
import { refuseCrossOrigin } from '@/lib/server/request'

export const dynamic = 'force-dynamic'
export async function GET() {
	try {
		const user = await currentUser()
		const subscription = user && billingConfigured() ? await readSubscription(user.id) : null
		return Response.json({ configured: authConfigured(), billing: billingConfigured(), user: user ? { id: user.id, email: user.email } : null,
			pro: subscriptionActive(subscription), subscription: subscription ? { status: subscription.status, periodEnd: subscription.period_end, cancelling: subscription.cancel_at_period_end } : null,
			quota: subscriptionActive(subscription) ? await paidQuota(subscription!) : null, allowance: paidLimits('question').monthly, daily: paidLimits('question').daily, speech: paidLimits('speech').monthly,
		}, { headers: { 'Cache-Control': 'no-store' } })
	} catch (err) {
		console.error('[loci] account lookup failed:', err instanceof Error ? err.message : err)
		return Response.json({ error: 'Could not load your account. Please try again.' }, { status: 503 })
	}
}
/** Reconcile after Checkout before claiming success; a success query parameter grants nothing. */
export async function POST(req: Request) {
	const refused = refuseCrossOrigin(req)
	if (refused) return refused
	try {
		const user = await currentUser()
		if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 })
		if (!billingConfigured()) return Response.json({ error: 'Subscriptions are not available yet.' }, { status: 503 })
		const subscription = await readSubscription(user.id)
		if (subscription) await syncCustomer(subscription.stripe_customer_id)
		return GET()
	} catch (err) {
		console.error('[loci] account refresh failed:', err instanceof Error ? err.message : err)
		return Response.json({ error: 'Payment status is still being confirmed. Refresh shortly.' }, { status: 503 })
	}
}
