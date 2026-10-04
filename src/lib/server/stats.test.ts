import { describe, expect, it } from 'vitest'
import { UpstashStore } from './limits'
import { MemoryStats, UpstashStats, costOf, lastDays, pricesFromEnv, sumDays } from './stats'
import { statsAuthorized } from './stats-auth'

describe('usage stats', () => {
	it('counts totals and distinct devices per day', async () => {
		const s = new MemoryStats()
		await s.add('2026-10-03', {}, { set: 'visitors', id: 'a' })
		await s.add('2026-10-03', {}, { set: 'visitors', id: 'a' })
		await s.add('2026-10-03', {}, { set: 'visitors', id: 'b' })
		await s.add('2026-10-03', { questions: 1, inputTokens: 1000, outputTokens: 200 }, { set: 'askers', id: 'a' })
		await s.add('2026-10-03', { questions: 1, inputTokens: 500 }, { set: 'askers', id: 'a' })
		const [day, other] = await s.read(['2026-10-03', '2026-10-02'])
		expect(day).toMatchObject({ visitors: 2, askers: 1, questions: 2, inputTokens: 1500, outputTokens: 200 })
		expect(other.questions).toBe(0)
	})

	it('estimates spend only once model prices are set', () => {
		const day = { ...sumDays([]), inputTokens: 2_000_000, cachedTokens: 1_000_000, outputTokens: 1_000_000, speechChars: 100_000 }
		expect(costOf(day, pricesFromEnv({} as NodeJS.ProcessEnv))).toEqual({ model: undefined, voice: 1.5 })
		const priced = pricesFromEnv({ LOCI_PRICE_INPUT: '0.3', LOCI_PRICE_CACHED_INPUT: '0.03', LOCI_PRICE_OUTPUT: '1.2' } as unknown as NodeJS.ProcessEnv)
		expect(costOf(day, priced).model).toBeCloseTo(0.3 + 0.03 + 1.2)
	})

	it('reads days back from Upstash', async () => {
		const commands: unknown[] = []
		const fake = (async (_url: string, init: RequestInit) => {
			commands.push(...JSON.parse(String(init.body)))
			return Response.json([{ result: ['questions', '3', 'outputTokens', '40', 'bogus', '9'] }, { result: 5 }, { result: 2 }])
		}) as unknown as typeof fetch
		const [day] = await new UpstashStats(new UpstashStore('https://test.upstash.io', 't', fake)).read(['2026-10-03'])
		expect(day).toMatchObject({ day: '2026-10-03', questions: 3, outputTokens: 40, visitors: 5, askers: 2, inputTokens: 0 })
		expect(day).not.toHaveProperty('bogus')
		expect(commands[0]).toEqual(['HGETALL', 'loci:stats:2026-10-03'])
	})

	it('lists recent UTC days newest first', () => {
		expect(lastDays(3, new Date('2026-10-03T01:00:00Z'))).toEqual(['2026-10-03', '2026-10-02', '2026-10-01'])
	})
})

describe('stats password', () => {
	const basic = (user: string, pass: string) => `Basic ${btoa(`${user}:${pass}`)}`
	it('accepts the right password with any username, and nothing without one configured', () => {
		expect(statsAuthorized(basic('me', 'hunter2:x'), 'hunter2:x')).toBe(true)
		expect(statsAuthorized(basic('me', 'hunter2'), 'hunter2:x')).toBe(false)
		expect(statsAuthorized(basic('me', ''), 'hunter2')).toBe(false)
		expect(statsAuthorized('Basic !!!', 'hunter2')).toBe(false)
		expect(statsAuthorized(basic('me', ''), undefined)).toBe(false)
		expect(statsAuthorized(null, 'hunter2')).toBe(false)
	})
})
