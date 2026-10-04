import { describe, expect, it } from 'vitest'
import { readLimitedBody, refuseCrossOrigin } from './request'
import { deviceFor } from './device'

describe('public request defenses', () => {
	it('bounds streamed bodies without relying on Content-Length', async () => {
		let cancelled = false
		const stream = new ReadableStream({
			start(c) { c.enqueue(new Uint8Array(5)); c.enqueue(new Uint8Array(6)) },
			cancel() { cancelled = true },
		})
		const req = new Request('https://loci.example/api/speech', { method: 'POST', body: stream, duplex: 'half' } as RequestInit)
		const result = await readLimitedBody(req, 10)
		expect(result).toBeInstanceOf(Response)
		expect((result as Response).status).toBe(413)
		expect(cancelled).toBe(true)
	})

	it('accepts bodies exactly at the limit', async () => {
		expect(await readLimitedBody(new Request('https://loci.example', { method: 'POST', body: 'hello' }), 5))
			.toEqual(new TextEncoder().encode('hello'))
	})

	it('rejects cross-site origins and allows same-site requests', () => {
		expect(refuseCrossOrigin(new Request('https://loci.example/api/tutor', { headers: { origin: 'https://evil.example' } }))?.status).toBe(403)
		expect(refuseCrossOrigin(new Request('https://loci.example/api/tutor', { headers: { origin: 'https://loci.example' } }))).toBeNull()
	})

	it('replaces malformed cookies rather than crashing the endpoint', () => {
		expect(deviceFor(new Request('https://loci.example', { headers: { cookie: 'loci_device=%ZZ' } })).setCookie).toBeDefined()
	})
})
