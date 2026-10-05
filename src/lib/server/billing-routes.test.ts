import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ user: vi.fn(), configured: vi.fn(), customer: vi.fn(), sync: vi.fn(), read: vi.fn(), price: vi.fn(), subscriptions: vi.fn(), sessions: vi.fn(), checkout: vi.fn(), portal: vi.fn() }))
vi.mock('./auth', () => ({ currentUser: mock.user, appOrigin: () => 'https://loci.example' }))
vi.mock('./billing', () => ({ billingConfigured: mock.configured, customerFor: mock.customer, syncCustomer: mock.sync, readSubscription: mock.read,
	stripeClient: () => ({ prices: { retrieve: mock.price }, subscriptions: { list: mock.subscriptions }, checkout: { sessions: { list: mock.sessions, create: mock.checkout } }, billingPortal: { sessions: { create: mock.portal } } }),
}))
import { POST as checkout } from '@/app/api/billing/checkout/route'
import { POST as portal } from '@/app/api/billing/portal/route'

const request = (path: string, origin = 'https://loci.example') => new Request(`https://loci.example/api/billing/${path}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ user_id: 'attacker', customer: 'cus_attacker', price: 'price_free' }) })
beforeEach(() => {
	vi.resetAllMocks()
	mock.configured.mockReturnValue(true)
	mock.user.mockResolvedValue({ id: 'owner', email: 'owner@example.com' })
	mock.customer.mockResolvedValue('cus_owner')
	mock.sync.mockResolvedValue(undefined)
	mock.read.mockResolvedValue({ stripe_customer_id: 'cus_owner' })
	mock.price.mockResolvedValue({ id: 'price_monthly', active: true, unit_amount: 800, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } })
	mock.subscriptions.mockResolvedValue({ data: [] })
	mock.sessions.mockResolvedValue({ data: [] })
	mock.checkout.mockResolvedValue({ url: 'https://checkout.stripe.com/example' })
	mock.portal.mockResolvedValue({ url: 'https://billing.stripe.com/example' })
})
describe('subscription ownership and checkout', () => {
	it('rejects cross-origin and unauthenticated requests before opening Stripe sessions', async () => {
		expect((await checkout(request('checkout', 'https://attacker.example'))).status).toBe(403)
		mock.user.mockResolvedValue(null)
		expect((await checkout(request('checkout'))).status).toBe(401)
		expect((await portal(request('portal'))).status).toBe(401)
		expect(mock.checkout).not.toHaveBeenCalled()
		expect(mock.portal).not.toHaveBeenCalled()
	})
	it('uses verified identity, the configured price and canonical redirect URLs', async () => {
		expect((await checkout(request('checkout'))).status).toBe(200)
		expect(mock.customer).toHaveBeenCalledWith({ id: 'owner', email: 'owner@example.com' })
		expect(mock.checkout).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_owner', client_reference_id: 'owner', line_items: [{ price: 'price_monthly', quantity: 1 }], success_url: 'https://loci.example/account?checkout=success' }), { idempotencyKey: expect.stringMatching(/^loci-checkout-owner-/) })
		await portal(request('portal'))
		expect(mock.read).toHaveBeenCalledWith('owner')
		expect(mock.portal).toHaveBeenCalledWith({ customer: 'cus_owner', return_url: 'https://loci.example/account' })
	})
	it('reuses an owned open checkout and redirects existing subscribers to billing', async () => {
		mock.sessions.mockResolvedValue({ data: [{ mode: 'subscription', metadata: { loci_user_id: 'owner', loci_price_id: 'price_monthly' }, url: 'https://checkout.stripe.com/existing' }] })
		expect(await (await checkout(request('checkout'))).json()).toEqual({ url: 'https://checkout.stripe.com/existing' })
		expect(mock.checkout).not.toHaveBeenCalled()
		mock.subscriptions.mockResolvedValue({ data: [{ status: 'active', items: { data: [{ price: { id: 'price_monthly' } }] } }] })
		expect(await (await checkout(request('checkout'))).json()).toEqual({ url: 'https://billing.stripe.com/example' })
		expect(mock.portal).toHaveBeenCalled()
	})
	it('does not sell a misconfigured price or open billing before setup', async () => {
		mock.price.mockResolvedValue({ active: true, unit_amount: 0, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } })
		expect((await checkout(request('checkout'))).status).toBe(503)
		expect(mock.checkout).not.toHaveBeenCalled()
		mock.configured.mockReturnValue(false)
		expect((await portal(request('portal'))).status).toBe(503)
		expect(mock.portal).not.toHaveBeenCalled()
	})
})
