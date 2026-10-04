import { describe, expect, it } from 'vitest'
import { UpstashStore } from './limits'
import { MemoryStats, UpstashStats, costOf, lastDays, pricesFromEnv, sumDays } from './stats'
import { statsAuthorized } from './stats-auth'

describe('usage stats', () => {
	it('counts totals and distinct devices per day', async () => {
		const s = new MemoryStats()
		await s.add('2026-10-03', {}, { id: 'a', unique: 'visitors' })
		await s.add('2026-10-03', {}, { id: 'a', unique: 'visitors' })
		await s.add('2026-10-03', {}, { id: 'b', unique: 'visitors' })
		await s.add('2026-10-03', { questions: 1, inputTokens: 1000, outputTokens: 200 }, { id: 'a', unique: 'askers' })
		await s.add('2026-10-03', { questions: 1, inputTokens: 500 }, { id: 'a', unique: 'askers' })
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

describe('per-visitor stats', () => {
	it('keeps each visitor’s totals, newest first', async () => {
		let now = 1000
		const s = new MemoryStats(() => now)
		await s.add('2026-10-03', { visits: 1 }, { id: 'a', country: 'CA', unique: 'visitors' })
		now = 2000
		await s.add('2026-10-03', { visits: 1 }, { id: 'b', unique: 'visitors' })
		now = 3000
		await s.add('2026-10-03', { questions: 1, inputTokens: 100, outputTokens: 10 }, { id: 'a', unique: 'askers' })
		const [a, b] = await s.visitors(10)
		expect(a).toMatchObject({ id: 'a', country: 'CA', visits: 1, questions: 1, inputTokens: 100, first: 1000, last: 3000 })
		expect(b).toMatchObject({ id: 'b', visits: 1, questions: 0 })
		// Board opens are a per-visitor count, not a daily total.
		expect((await s.read(['2026-10-03']))[0]).not.toHaveProperty('visits')
	})

	it('writes and reads visitors through Upstash', async () => {
		const sent: unknown[][] = []
		const fake = (async (_url: string, init: RequestInit) => {
			sent.push(JSON.parse(String(init.body)))
			return Response.json([])
		}) as unknown as typeof fetch
		const stats = new UpstashStats(new UpstashStore('https://test.upstash.io', 't', fake), () => 5000)
		await stats.add('2026-10-03', { questions: 1 }, { id: 'a', country: 'CA', unique: 'askers' })
		expect(sent[0]).toContainEqual(['HINCRBY', 'loci:stats:visitor:a', 'questions', 1])
		expect(sent[0]).toContainEqual(['HSET', 'loci:stats:visitor:a', 'last', 5000, 'country', 'CA'])
		expect(sent[0]).toContainEqual(['ZADD', 'loci:stats:visitors', 5000, 'a'])
		let call = 0
		const replies = [[{ result: ['a'] }], [{ result: ['questions', '2', 'first', '100', 'last', '5000', 'country', 'CA'] }]]
		const reader = new UpstashStats(
			new UpstashStore('https://test.upstash.io', 't', (async () => Response.json(replies[call++])) as unknown as typeof fetch)
		)
		expect(await reader.visitors(10)).toEqual([expect.objectContaining({ id: 'a', questions: 2, first: 100, last: 5000, country: 'CA' })])
	})
})
