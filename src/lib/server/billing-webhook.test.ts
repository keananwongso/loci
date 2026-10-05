import { afterEach, describe, expect, it, vi } from 'vitest'
import Stripe from 'stripe'
const { sync } = vi.hoisted(() => ({ sync: vi.fn() }))
vi.mock('./billing', () => ({ stripeClient: () => new Stripe('sk_test_example'), syncCustomer: sync }))
import { POST } from '@/app/api/billing/webhook/route'
const secret = 'whsec_test_only'
const payload = JSON.stringify({ id: 'evt_1', object: 'event', type: 'customer.subscription.updated', data: { object: { customer: 'cus_owner' } } })
const signed = (body = payload, signatureBody = body) => new Request('https://loci.example/api/billing/webhook', { method: 'POST', body, headers: { 'stripe-signature': Stripe.webhooks.generateTestHeaderString({ payload: signatureBody, secret }) } })
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })
describe('verified subscription webhooks', () => {
	it('rejects tampered bodies before updating access', async () => {
		vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_example'); vi.stubEnv('STRIPE_WEBHOOK_SECRET', secret)
		expect((await POST(signed(payload.replace('cus_owner', 'cus_attacker'), payload))).status).toBe(400)
		expect(sync).not.toHaveBeenCalled()
	})
	it('accepts valid events and retries when database reconciliation fails', async () => {
		vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_example'); vi.stubEnv('STRIPE_WEBHOOK_SECRET', secret)
		sync.mockResolvedValueOnce(undefined)
		expect((await POST(signed())).status).toBe(200)
		expect(sync).toHaveBeenCalledWith('cus_owner')
		sync.mockRejectedValueOnce(new Error('database unavailable'))
		expect((await POST(signed())).status).toBe(503)
	})
})
