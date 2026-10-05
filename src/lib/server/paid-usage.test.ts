import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryStore } from './limits'
import { paidUsage, paidQuota } from './paid-usage'
import { subscriptionActive, type Subscription } from './billing'
const subscription: Subscription = { user_id: 'account-1', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', status: 'active', period_start: Math.floor(Date.now() / 1000) - 100, period_end: Math.floor(Date.now() / 1000) + 86400, cancel_at_period_end: false }
afterEach(() => vi.unstubAllEnvs())
describe('paid subscription allowances', () => {
	it('does not grant access for unpaid, cancelled, future or expired periods', () => {
		expect(subscriptionActive(subscription)).toBe(true)
		expect(subscriptionActive({ ...subscription, cancel_at_period_end: true })).toBe(true)
		for (const status of ['past_due', 'unpaid', 'incomplete', 'canceled', 'paused']) expect(subscriptionActive({ ...subscription, status })).toBe(false)
		expect(subscriptionActive({ ...subscription, period_end: 1 })).toBe(false)
		expect(subscriptionActive({ ...subscription, period_start: subscription.period_end })).toBe(false)
	})
	it('atomically stops concurrent requests at the monthly cap and isolates accounts', async () => {
		vi.stubEnv('LOCI_PRO_QUESTIONS', '3')
		const store = new MemoryStore()
		const results = await Promise.all(Array.from({ length: 20 }, () => paidUsage(subscription, 'question', 1, store)))
		expect(results.filter((r) => r.ok)).toHaveLength(3)
		expect(results.filter((r) => !r.ok).every((r) => r.reason === 'subscription')).toBe(true)
		expect(await paidQuota(subscription, store)).toEqual({ limit: 3, remaining: 0 })
		expect((await paidUsage({ ...subscription, user_id: 'account-2' }, 'question', 1, store)).ok).toBe(true)
		expect((await paidUsage({ ...subscription, period_start: subscription.period_start + 200 }, 'question', 1, store)).ok).toBe(true)
	})
	it('separately caps paid voice and daily usage', async () => {
		vi.stubEnv('LOCI_PRO_SPEECH_CHARS', '5')
		vi.stubEnv('LOCI_PRO_QUESTIONS_DAILY', '1')
		const store = new MemoryStore()
		expect((await paidUsage(subscription, 'speech', 5, store)).ok).toBe(true)
		expect((await paidUsage(subscription, 'speech', 1, store)).reason).toBe('subscription')
		expect((await paidUsage(subscription, 'question', 1, store)).ok).toBe(true)
		expect((await paidUsage(subscription, 'question', 1, store)).reason).toBe('daily')
	})
})
