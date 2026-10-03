import { describe, expect, it } from 'vitest'
import { decode } from '@msgpack/msgpack'
import { FishError, fishConfigFromEnv, fishSpeech, fishTranscribe } from './fish'

describe('fishSpeech', () => {
	it('sends the SDK-shaped request and streams the audio back', async () => {
		let seen: { url: string; init: RequestInit } | undefined
		const fake = (async (url: string, init: RequestInit) => {
			seen = { url, init }
			return new Response(new Uint8Array([0xff, 0xfb, 0x90]), { status: 200 })
		}) as unknown as typeof fetch
		const body = await fishSpeech('Hello there.', { apiKey: 'fk', model: 's2-pro', voiceId: 'voice123', fetch: fake })
		const bytes = new Uint8Array(await new Response(body).arrayBuffer())
		expect([...bytes]).toEqual([0xff, 0xfb, 0x90])
		expect(seen!.url).toBe('https://api.fish.audio/v1/tts')
		const headers = new Headers(seen!.init.headers)
		expect(headers.get('authorization')).toBe('Bearer fk')
		expect(headers.get('model')).toBe('s2-pro')
		expect(headers.get('content-type')).toBe('application/msgpack')
		const payload = decode(seen!.init.body as Uint8Array) as Record<string, unknown>
		expect(payload).toMatchObject({ text: 'Hello there.', format: 'mp3', latency: 'balanced', reference_id: 'voice123' })
	})

	it('reports a bad key clearly', async () => {
		const fake = (async () => new Response('unauthorized', { status: 401 })) as unknown as typeof fetch
		await expect(fishSpeech('x', { apiKey: 'bad', model: 's2-pro', fetch: fake })).rejects.toThrow(/rejected the API key/)
	})

	it('needs a key', async () => {
		await expect(fishSpeech('x', fishConfigFromEnv({} as unknown as NodeJS.ProcessEnv))).rejects.toBeInstanceOf(FishError)
	})
})

describe('fishTranscribe', () => {
	it('posts the clip as multipart and returns the text', async () => {
		let seen: { url: string; init: RequestInit } | undefined
		const fake = (async (url: string, init: RequestInit) => {
			seen = { url, init }
			return Response.json({ text: ' what is u ', duration: 1.2 })
		}) as unknown as typeof fetch
		const text = await fishTranscribe(new Blob([new Uint8Array(10)], { type: 'audio/webm' }), { apiKey: 'fk', model: 's2-pro', fetch: fake })
		expect(text).toBe('what is u')
		expect(seen!.url).toBe('https://api.fish.audio/v1/asr')
		expect(new Headers(seen!.init.headers).get('authorization')).toBe('Bearer fk')
		// The TTS model must not leak into the transcription request.
		expect(new Headers(seen!.init.headers).get('model')).toBeNull()
		const form = seen!.init.body as FormData
		expect(form.get('audio')).toBeInstanceOf(Blob)
	})
})
