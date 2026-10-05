import { stripeClient, syncCustomer } from '@/lib/server/billing'
import { readLimitedBody } from '@/lib/server/request'
import type Stripe from 'stripe'

export const runtime = 'nodejs'
export async function POST(req: Request) {
	if (!process.env.STRIPE_WEBHOOK_SECRET || !process.env.STRIPE_SECRET_KEY) return new Response('Billing unavailable.', { status: 503 })
	const signature = req.headers.get('stripe-signature')
	if (!signature) return new Response('Missing signature.', { status: 400 })
	const body = await readLimitedBody(req, 1024 * 1024)
	if (body instanceof Response) return body
	let event: Stripe.Event
	try { event = stripeClient().webhooks.constructEvent(Buffer.from(body), signature, process.env.STRIPE_WEBHOOK_SECRET) }
	catch { return new Response('Invalid signature.', { status: 400 }) }
	try {
		if (event.type.startsWith('customer.subscription.') || event.type === 'checkout.session.completed' || event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
			const object = event.data.object as { customer?: string | { id: string } | null }
			const customer = typeof object.customer === 'string' ? object.customer : object.customer?.id
			if (customer) await syncCustomer(customer)
		}
		return Response.json({ received: true })
	} catch (err) {
		console.error('[loci] webhook sync failed:', err instanceof Error ? err.message : err)
		// Non-2xx tells Stripe to retry; never acknowledge an update that wasn't saved.
		return new Response('Subscription sync failed.', { status: 503 })
	}
}
