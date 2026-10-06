import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
	vi.resetModules()
	vi.stubGlobal('window', { dispatchEvent: vi.fn() })
})
afterEach(() => vi.unstubAllGlobals())

describe('account upload queue', () => {
	it('keeps a burst of replay files below the server reservation cap and waits for every queued file', async () => {
		let pending = 0, maximum = 0, completed = 0
		const finish: (() => void)[] = []
		vi.stubGlobal('fetch', vi.fn(async (url: string) => {
			if (url === '/api/files') {
				if (pending >= 8) return Response.json({ error: 'Too many uploads at once.' }, { status: 429 })
				maximum = Math.max(maximum, ++pending)
				return Response.json({ uploadUrl: 'https://storage.test/upload' })
			}
			if (url === 'https://storage.test/upload')
				return new Promise<Response>((resolve) => finish.push(() => resolve(new Response(null, { status: 200 }))))
			pending--
			completed++
			return Response.json({ committed: true })
		}))
		const { uploadFile, pendingUploads } = await import('./cloud')
		// Repeated keys must also stay tracked: an earlier completion cannot drop a later upload.
		const requests = Array.from({ length: 12 }, () => uploadFile('replay', new Blob(['audio'], { type: 'audio/mpeg' }), 'board'))
		let saved = false
		const saving = pendingUploads().then(() => { saved = true })
		for (let i = 0; i < 12; i++) {
			await vi.waitFor(() => expect(finish).toHaveLength(i + 1))
			expect(saved).toBe(false)
			finish[i]()
		}
		await Promise.all(requests)
		await saving
		expect(completed).toBe(12)
		expect(maximum).toBe(1)
		expect(saved).toBe(true)
	})

	it('reports a failed reservation and continues with the next queued file', async () => {
		let reservations = 0
		vi.stubGlobal('fetch', vi.fn(async (url: string) => {
			if (url === '/api/files') {
				if (++reservations === 1) return Response.json({ error: 'Storage unavailable' }, { status: 503 })
				return Response.json({ uploadUrl: 'https://storage.test/upload' })
			}
			return Response.json({ committed: true })
		}))
		const { uploadFile } = await import('./cloud')
		const results = await Promise.allSettled([
			uploadFile('first', new Blob(['a']), 'board'),
			uploadFile('second', new Blob(['b']), 'board')
		])
		expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled'])
		expect(window.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ detail: 'Storage unavailable' }))
	})
})
