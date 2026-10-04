import { describe, expect, it } from 'vitest'
import { MemoryStore, UpstashStore, limitConfigFromEnv, readQuota, takeQuestion, takeUsage, getStore } from './limits'
import { deviceFor, ipHashFor } from './device'

const config = {
	enabled: true,
	perDevice: 2,
	perIp: 3,
	global: 5,
	speech: { perDevice: 100, perIp: 300, global: 1000 },
	transcribe: { perDevice: 2, perIp: 4, global: 10 },
}

describe('demo limits', () => {
	it('limits a device, then the network, then everyone', async () => {
		const s = new MemoryStore()
		expect((await takeQuestion(config, 'dev-a', 'ip-1', s)).ok).toBe(true)
		const second = await takeQuestion(config, 'dev-a', 'ip-1', s)
		expect(second.ok && second.quota.remaining).toBe(0)
		const blocked = await takeQuestion(config, 'dev-a', 'ip-1', s)
		expect(!blocked.ok && blocked.reason).toBe('device')

		// a fresh incognito window on the same network gets one more, then the IP limit kicks in
		expect((await takeQuestion(config, 'dev-b', 'ip-1', s)).ok).toBe(true)
		const ipBlocked = await takeQuestion(config, 'dev-c', 'ip-1', s)
		expect(!ipBlocked.ok && ipBlocked.reason).toBe('ip')

		// other networks are fine until the global cap
		expect((await takeQuestion(config, 'dev-d', 'ip-2', s)).ok).toBe(true)
		expect((await takeQuestion(config, 'dev-d', 'ip-2', s)).ok).toBe(true)
		const globalBlocked = await takeQuestion(config, 'dev-e', 'ip-3', s)
		expect(!globalBlocked.ok && globalBlocked.reason).toBe('global')
		expect((await readQuota(config, 'dev-z', 'ip-9', s)).remaining).toBe(0)
	})

	it('does not overspend under simultaneous requests', async () => {
		const s = new MemoryStore()
		const results = await Promise.all(Array.from({ length: 30 }, () => takeQuestion(config, 'same-device', 'same-ip', s)))
		expect(results.filter((r) => r.ok)).toHaveLength(2)
		expect((await readQuota(config, 'same-device', 'same-ip', s)).remaining).toBe(0)
	})

	it('counts speech in characters, separately from questions', async () => {
		const s = new MemoryStore()
		expect((await takeUsage('speech', config.speech, 'dev-a', 'ip-1', 60, s)).ok).toBe(true)
		// 60 + 50 would pass the device's 100 characters
		const over = await takeUsage('speech', config.speech, 'dev-a', 'ip-1', 50, s)
		expect(!over.ok && over.reason).toBe('device')
		expect(over.quota.remaining).toBe(40)
		expect((await takeUsage('speech', config.speech, 'dev-a', 'ip-1', 40, s)).ok).toBe(true)
		// speech used none of the questions
		expect((await readQuota(config, 'dev-a', 'ip-1', s)).remaining).toBe(2)
	})

	it('is off unless enabled', () => {
		expect(limitConfigFromEnv({} as unknown as NodeJS.ProcessEnv).enabled).toBe(false)
		expect(limitConfigFromEnv({ LOCI_DEMO_LIMITS: 'on', LOCI_LIMIT_PER_DEVICE: '7' } as unknown as NodeJS.ProcessEnv)).toMatchObject({
			enabled: true,
			perDevice: 7,
			perIp: 20,
			global: 300,
		})
	})

	it('reserves usage through one Redis EVAL and preserves refusal counts', async () => {
		const calls: unknown[][][] = []
		const fake = (async (_url: string, init: RequestInit) => {
			calls.push(JSON.parse(String(init.body)))
			return Response.json([{ result: calls.length === 1 ? [0, 2, 3, 5] : [1, 2, 3, 5] }])
		}) as typeof fetch
		const s = new UpstashStore('https://x.upstash.io', 'tok', fake)
		expect(await takeQuestion(config, 'dev', 'ip', s)).toEqual({ ok: true, quota: { limit: 2, remaining: 0 } })
		expect(await takeQuestion(config, 'dev', 'ip', s)).toEqual({ ok: false, reason: 'global', quota: { limit: 2, remaining: 0 } })
		expect(calls[0]).toHaveLength(1)
		expect(calls[0][0][0]).toBe('EVAL')
		expect(calls[0][0].slice(2)).toEqual([
			3,
			expect.stringContaining('dev:dev'),
			expect.stringContaining('ip:ip'),
			expect.stringContaining('all'),
			1,
			93600,
			2,
			3,
			5,
		])
	})

	it('requires persistent limits and signing in production', () => {
		expect(() => getStore({ NODE_ENV: 'production', LOCI_DEMO_LIMITS: 'on' } as NodeJS.ProcessEnv)).toThrow('Hosted limits require')
		expect(limitConfigFromEnv({ NODE_ENV: 'production', VERCEL: '1' } as NodeJS.ProcessEnv).enabled).toBe(true)
		expect(limitConfigFromEnv({ NODE_ENV: 'production', VERCEL: '1', LOCI_DEMO_LIMITS: 'off' } as NodeJS.ProcessEnv).enabled).toBe(false)
	})

	it('speaks the Upstash REST pipeline format', async () => {
		const sent: unknown[] = []
		const fake = (async (url: string, init: RequestInit) => {
			sent.push({ url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get('authorization') })
			const cmds = JSON.parse(String(init.body)) as unknown[][]
			return Response.json(cmds.map((c) => ({ result: c[0] === 'MGET' ? [null, '2', '7'] : c[0] === 'INCRBY' ? 3 : 1 })))
		}) as unknown as typeof fetch
		const s = new UpstashStore('https://x.upstash.io/', 'tok', fake)
		expect(await s.get(['a', 'b', 'c'])).toEqual([0, 2, 7])
		expect(await s.incr(['a'], 100)).toEqual([3])
		expect(sent[1]).toMatchObject({
			url: 'https://x.upstash.io/pipeline',
			auth: 'Bearer tok',
			body: [
				['INCRBY', 'a', 1],
				['EXPIRE', 'a', 100, 'NX'],
			],
		})
	})
})

describe('device id', () => {
	it('issues a signed cookie and accepts it back, rejecting forgeries', () => {
		const first = deviceFor(new Request('https://loci.example/api/tutor'))
		expect(first.setCookie).toMatch(/^loci_device=.+; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax; Secure$/)
		const value = first.setCookie!.split(';')[0].split('=')[1]
		const again = deviceFor(new Request('https://loci.example/api/tutor', { headers: { cookie: `loci_device=${value}` } }))
		expect(again).toEqual({ id: first.id })
		const forged = deviceFor(
			new Request('https://loci.example/api/tutor', { headers: { cookie: `loci_device=someone-else.${value.split('.')[1]}` } }),
		)
		expect(forged.id).not.toBe('someone-else')
		expect(forged.setCookie).toBeDefined()
	})

	it('hashes IPs instead of storing them', () => {
		const h = ipHashFor(new Request('https://x', { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } }))
		expect(h).not.toContain('203')
		expect(h).toBe(ipHashFor(new Request('https://x', { headers: { 'x-forwarded-for': '203.0.113.7' } })))
	})
})


describe('Vercel Redis integration', () => {
	it('recognizes Marketplace credentials without needing copied aliases', () => {
		const store = getStore({ NODE_ENV: 'production', LOCI_DEMO_LIMITS: 'on', LOCI_COOKIE_SECRET: 'test-secret', KV_REST_API_URL: 'https://test.upstash.io', KV_REST_API_TOKEN: 'test-token' })
		expect(store).toBeInstanceOf(UpstashStore)
	})
})
