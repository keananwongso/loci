import { describe, expect, it } from 'vitest'
import { decode } from '@msgpack/msgpack'
import { FishError, fishConfigFromEnv, fishSpeech, fishTranscribe } from './fish'

const base = { model: 's2-pro', speed: 0.92, temperature: 0.85, latency: 'balanced' as const }

describe('fishSpeech', () => {
	it('sends the SDK-shaped request and streams the audio back', async () => {
		let seen: { url: string; init: RequestInit } | undefined
		const fake = (async (url: string, init: RequestInit) => {
			seen = { url, init }
			return new Response(new Uint8Array([0xff, 0xfb, 0x90]), { status: 200 })
		}) as unknown as typeof fetch
		const body = await fishSpeech('Hello there.', { ...base, apiKey: 'fk', voiceId: 'voice123', fetch: fake })
		const bytes = new Uint8Array(await new Response(body).arrayBuffer())
		expect([...bytes]).toEqual([0xff, 0xfb, 0x90])
		expect(seen!.url).toBe('https://api.fish.audio/v1/tts')
		const headers = new Headers(seen!.init.headers)
		expect(headers.get('authorization')).toBe('Bearer fk')
		expect(headers.get('model')).toBe('s2-pro')
		expect(headers.get('content-type')).toBe('application/msgpack')
		const payload = decode(seen!.init.body as Uint8Array) as Record<string, unknown>
		expect(payload).toMatchObject({
			text: 'Hello there.',
			format: 'mp3',
			latency: 'balanced',
			reference_id: 'voice123',
			temperature: 0.85,
			prosody: { speed: 0.92, volume: 0 },
		})
	})

	it('reads the pace and delivery from the environment, within range', () => {
		const env = { LOCI_TTS_SPEED: '5', LOCI_TTS_TEMPERATURE: '0.6', LOCI_TTS_LATENCY: 'normal' } as unknown as NodeJS.ProcessEnv
		expect(fishConfigFromEnv(env)).toMatchObject({ speed: 2, temperature: 0.6, latency: 'normal' })
		expect(fishConfigFromEnv({} as unknown as NodeJS.ProcessEnv)).toMatchObject({ speed: 0.92, temperature: 0.85, latency: 'balanced' })
	})

	it('reports a bad key clearly', async () => {
		const fake = (async () => new Response('unauthorized', { status: 401 })) as unknown as typeof fetch
		await expect(fishSpeech('x', { ...base, apiKey: 'bad', fetch: fake })).rejects.toThrow(/rejected the API key/)
	})

	it('needs a key', async () => {
		await expect(fishSpeech('x', fishConfigFromEnv({} as unknown as NodeJS.ProcessEnv))).rejects.toBeInstanceOf(FishError)
	})
})

describe('fishTranscribe', () => {
	it('rejects a Chinese result despite the English language hint', async () => {
		const fake = (async () => Response.json({ text: '东台市。' })) as typeof fetch
		const text = await fishTranscribe(new Blob(['audio'], { type: 'audio/wav' }), { ...base, apiKey: 'fk', fetch: fake })
		expect(text).toBe('')
	})

	it('posts the clip as multipart and returns the text', async () => {
		let seen: { url: string; init: RequestInit } | undefined
		const fake = (async (url: string, init: RequestInit) => {
			seen = { url, init }
			return Response.json({ text: ' what is u ', duration: 1.2 })
		}) as unknown as typeof fetch
		const text = await fishTranscribe(new Blob([new Uint8Array(10)], { type: 'audio/webm' }), { ...base, apiKey: 'fk', fetch: fake })
		expect(text).toBe('what is u')
		expect(seen!.url).toBe('https://api.fish.audio/v1/asr')
		expect(new Headers(seen!.init.headers).get('authorization')).toBe('Bearer fk')
		// The TTS model must not leak into the transcription request.
		expect(new Headers(seen!.init.headers).get('model')).toBeNull()
		const form = seen!.init.body as FormData
		expect(form.get('audio')).toBeInstanceOf(Blob)
		expect(form.get('language')).toBe('en')
	})
})
