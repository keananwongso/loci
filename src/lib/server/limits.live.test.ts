import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { UpstashStore } from './limits'

/** Opt-in integration check. Isolated keys expire and are deleted after each run. */
describe.skipIf(process.env.LOCI_TEST_REDIS !== '1')('live Redis limits', () => {
	it('atomically enforces device, network, global and character limits across clients', async () => {
		const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL!
		const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN!
		const clients = [new UpstashStore(url, token), new UpstashStore(url, token)]
		const prefix = `loci:verification:${randomUUID()}`
		const keys = new Set<string>()
		const counters = (device: string, ip: string) => {
			const k = [`${prefix}:dev:${device}`, `${prefix}:ip:${ip}`, `${prefix}:all`]
			k.forEach(key => keys.add(key))
			return k
		}
		try {
			const same = counters('a', 'a')
			const results = await Promise.all(Array.from({ length: 20 }, (_, i) => clients[i % 2].reserve(same, [2, 3, 5], 1, 60)))
			expect(results.filter(r => r.reason === 0)).toHaveLength(2)
			expect(await clients[1].get(same)).toEqual([2, 2, 2])
			expect((await clients[0].reserve(same, [2, 3, 5], 1, 60)).reason).toBe(2)
			expect((await clients[0].reserve(counters('b', 'a'), [2, 3, 5], 1, 60)).reason).toBe(0)
			expect((await clients[1].reserve(counters('c', 'a'), [2, 3, 5], 1, 60)).reason).toBe(3)
			expect((await clients[0].reserve(counters('d', 'b'), [2, 3, 5], 2, 60)).reason).toBe(0)
			expect((await clients[1].reserve(counters('e', 'c'), [2, 3, 5], 1, 60)).reason).toBe(1)
			expect((await clients[0].get(same))[2]).toBe(5)
			const chars = [`${prefix}:speech:dev`, `${prefix}:speech:ip`, `${prefix}:speech:all`]
			chars.forEach(key => keys.add(key))
			expect((await clients[0].reserve(chars, [100, 300, 1000], 60, 60)).reason).toBe(0)
			expect((await clients[1].reserve(chars, [100, 300, 1000], 50, 60)).reason).toBe(2)
			expect(await clients[0].get(chars)).toEqual([60, 60, 60])
			const res = await fetch(`${url}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify([['TTL', same[0]]]) })
			const ttl = await res.json()
			expect(ttl[0].result).toBeGreaterThan(0)
			expect(ttl[0].result).toBeLessThanOrEqual(60)
		} finally {
			const res = await fetch(`${url}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify([['DEL', ...keys]]) })
			expect(res.ok).toBe(true)
		}
	}, 30000)
})
