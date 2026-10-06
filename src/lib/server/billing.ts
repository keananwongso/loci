import 'server-only'
import Stripe from 'stripe'
import type { User } from '@supabase/supabase-js'
import { accountDb, authConfigured, currentUser } from './auth'

export interface Subscription {
	user_id: string; stripe_customer_id: string; stripe_subscription_id: string | null
	status: string; period_start: number; period_end: number; cancel_at_period_end: boolean
}
export const billingConfigured = () => Boolean(authConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID && process.env.STRIPE_WEBHOOK_SECRET && process.env.LOCI_APP_URL)
export const stripeClient = () => {
	if (!process.env.STRIPE_SECRET_KEY) throw new Error('Billing is not configured.')
	return new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2, timeout: 15000 })
}
export const subscriptionActive = (subscription: Subscription | null, now = Date.now() / 1000) => Boolean(subscription && (subscription.status === 'active' || subscription.status === 'trialing') && subscription.period_start <= now && subscription.period_end > now)

export async function readSubscription(userId: string): Promise<Subscription | null> {
	const { data, error } = await accountDb().from('loci_billing').select('*').eq('user_id', userId).maybeSingle()
	if (error) throw error
	return data
}

/** Who is asking: a paying subscription, and the signed-in account whose free allowance applies otherwise. */
export async function viewer(): Promise<{ paid: Subscription | null; userId: string | null }> {
	if (!authConfigured()) return { paid: null, userId: null }
	const user = await currentUser()
	if (!user) return { paid: null, userId: null }
	if (!billingConfigured()) return { paid: null, userId: user.id }
	const subscription = await readSubscription(user.id)
	return { paid: subscriptionActive(subscription) ? subscription : null, userId: user.id }
}

export async function paidAccount(): Promise<Subscription | null> {
	return (await viewer()).paid
}

/** Free questions count per account once signed in, so a new browser doesn't reset them. */
export const meterId = (deviceId: string, userId: string | null) => (userId ? `acct-${userId}` : deviceId)

export async function customerFor(user: User) {
	const existing = await readSubscription(user.id)
	if (existing) return existing.stripe_customer_id
	const customer = await stripeClient().customers.create({ email: user.email, metadata: { loci_user_id: user.id } }, { idempotencyKey: `loci-customer-${user.id}` })
	const { error } = await accountDb().from('loci_billing').upsert({ user_id: user.id, stripe_customer_id: customer.id }, { onConflict: 'user_id', ignoreDuplicates: true })
	if (error) throw error
	return customer.id
}

/** Fetch current Stripe state so late or repeated webhooks cannot replay an old status. */
export async function syncCustomer(customerId: string) {
	const observedAt = Date.now()
	const db = accountDb()
	const { data: owner, error } = await db.from('loci_billing').select('user_id').eq('stripe_customer_id', customerId).maybeSingle()
	if (error) throw error
	if (!owner) return
	const stripe = stripeClient()
	const subscriptions = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })
	const valid = subscriptions.data.filter((s) => s.items.data.some((item) => item.price.id === process.env.STRIPE_PRICE_ID))
	const subscription = valid.find((s) => s.status === 'active' || s.status === 'trialing') ?? valid.sort((a, b) => b.created - a.created)[0]
	const item = subscription?.items.data.find((i) => i.price.id === process.env.STRIPE_PRICE_ID)
	const { error: syncError } = await db.rpc('loci_sync_billing', {
		p_customer: customerId, p_subscription: subscription?.id ?? null, p_status: subscription?.status ?? 'none',
		p_start: item?.current_period_start ?? 0, p_end: item?.current_period_end ?? 0,
		p_cancel: subscription?.cancel_at_period_end ?? false, p_observed: observedAt,
	})
	if (syncError) throw syncError
}
