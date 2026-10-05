import { appOrigin, currentUser } from '@/lib/server/auth'
import { billingConfigured, customerFor, stripeClient, syncCustomer } from '@/lib/server/billing'
import { refuseCrossOrigin } from '@/lib/server/request'

export async function POST(req: Request) {
	const refused = refuseCrossOrigin(req)
	if (refused) return refused
	if (!billingConfigured()) return Response.json({ error: 'Subscriptions are not available yet.' }, { status: 503 })
	try {
		const user = await currentUser()
		if (!user) return Response.json({ error: 'Sign in before subscribing.' }, { status: 401 })
		const stripe = stripeClient()
		const price = await stripe.prices.retrieve(process.env.STRIPE_PRICE_ID!)
		if (!price.active || price.unit_amount !== 800 || price.currency !== 'usd' || price.recurring?.interval !== 'month' || price.recurring.interval_count !== 1) throw new Error('STRIPE_PRICE_ID must be the active US$8/month Loci price.')
		const customer = await customerFor(user)
		await syncCustomer(customer)
		const subscriptions = await stripe.subscriptions.list({ customer, status: 'all', limit: 100 })
		const existing = subscriptions.data.some((s) => !['canceled', 'incomplete_expired'].includes(s.status) && s.items.data.some((i) => i.price.id === price.id))
		if (existing) {
			const portal = await stripe.billingPortal.sessions.create({ customer, return_url: `${appOrigin(req)}/account` })
			return Response.json({ url: portal.url })
		}
		// Reuse an unfinished checkout rather than opening another subscription flow.
		const sessions = await stripe.checkout.sessions.list({ customer, status: 'open', limit: 10 })
		const open = sessions.data.find((s) => s.mode === 'subscription' && s.metadata?.loci_user_id === user.id && s.metadata?.loci_price_id === price.id)
		if (open?.url) return Response.json({ url: open.url })
		const session = await stripe.checkout.sessions.create({
			mode: 'subscription', customer, line_items: [{ price: price.id, quantity: 1 }],
			client_reference_id: user.id, metadata: { loci_user_id: user.id, loci_price_id: price.id }, subscription_data: { metadata: { loci_user_id: user.id } },
			success_url: `${appOrigin(req)}/account?checkout=success`, cancel_url: `${appOrigin(req)}/account?checkout=cancelled`,
			allow_promotion_codes: false,
		}, { idempotencyKey: `loci-checkout-${user.id}-${Math.floor(Date.now() / 1800000)}` })
		if (!session.url) throw new Error('Checkout did not return a URL.')
		return Response.json({ url: session.url })
	} catch (err) {
		console.error('[loci] checkout failed:', err instanceof Error ? err.message : err)
		return Response.json({ error: 'Could not open checkout. Please try again.' }, { status: 503 })
	}
}
