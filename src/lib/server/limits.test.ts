import { describe, expect, it } from 'vitest'
import { MemoryStore, UpstashStore, limitConfigFromEnv, readQuota, takeQuestion } from './limits'
import { deviceFor, ipHashFor } from './device'

const config = { enabled: true, perDevice: 2, perIp: 3, global: 5 }

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

	it('is off unless enabled', () => {
		expect(limitConfigFromEnv({} as unknown as NodeJS.ProcessEnv).enabled).toBe(false)
		expect(limitConfigFromEnv({ LOCI_DEMO_LIMITS: 'on', LOCI_LIMIT_PER_DEVICE: '7' } as unknown as NodeJS.ProcessEnv)).toMatchObject({ enabled: true, perDevice: 7, perIp: 20, global: 300 })
	})

	it('speaks the Upstash REST pipeline format', async () => {
		const sent: unknown[] = []
		const fake = (async (url: string, init: RequestInit) => {
			sent.push({ url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get('authorization') })
			const cmds = JSON.parse(String(init.body)) as unknown[][]
			return Response.json(cmds.map((c) => ({ result: c[0] === 'MGET' ? [null, '2', '7'] : c[0] === 'INCR' ? 3 : 1 })))
		}) as unknown as typeof fetch
		const s = new UpstashStore('https://x.upstash.io/', 'tok', fake)
		expect(await s.get(['a', 'b', 'c'])).toEqual([0, 2, 7])
		expect(await s.incr(['a'], 100)).toEqual([3])
		expect(sent[1]).toMatchObject({ url: 'https://x.upstash.io/pipeline', auth: 'Bearer tok', body: [['INCR', 'a'], ['EXPIRE', 'a', 100, 'NX']] })
	})
})

describe('device id', () => {
	it('issues a signed cookie and accepts it back, rejecting forgeries', () => {
		const first = deviceFor(new Request('https://loci.example/api/tutor'))
		expect(first.setCookie).toMatch(/^loci_device=.+; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax; Secure$/)
		const value = first.setCookie!.split(';')[0].split('=')[1]
		const again = deviceFor(new Request('https://loci.example/api/tutor', { headers: { cookie: `loci_device=${value}` } }))
		expect(again).toEqual({ id: first.id })
		const forged = deviceFor(new Request('https://loci.example/api/tutor', { headers: { cookie: `loci_device=someone-else.${value.split('.')[1]}` } }))
		expect(forged.id).not.toBe('someone-else')
		expect(forged.setCookie).toBeDefined()
	})

	it('hashes IPs instead of storing them', () => {
		const h = ipHashFor(new Request('https://x', { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } }))
		expect(h).not.toContain('203')
		expect(h).toBe(ipHashFor(new Request('https://x', { headers: { 'x-forwarded-for': '203.0.113.7' } })))
	})
})
