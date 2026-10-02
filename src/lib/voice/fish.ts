import 'server-only'
/**
 * Fish Audio text to speech, called from the local server so the key never reaches the browser.
 * Request shape mirrors Fish's official SDK: POST /v1/tts, msgpack body, model in a header.
 */
import { encode } from '@msgpack/msgpack'

export const FISH_URL = 'https://api.fish.audio/v1/tts'
export const MAX_SPEECH_CHARS = 1500

export interface FishConfig {
	apiKey?: string
	model: string
	voiceId?: string
	fetch?: typeof fetch
}

export function fishConfigFromEnv(env: NodeJS.ProcessEnv = process.env): FishConfig {
	return { apiKey: env.FISH_API_KEY || undefined, model: env.LOCI_TTS_MODEL || 's2-pro', voiceId: env.FISH_VOICE_ID || undefined }
}

export class FishError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message)
	}
}

/** Synthesize `text` to mp3. Returns the streaming response body. */
export async function fishSpeech(text: string, config: FishConfig, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
	if (!config.apiKey) throw new FishError(503, 'FISH_API_KEY is not set.')
	const payload: Record<string, unknown> = { text, format: 'mp3', mp3_bitrate: 128, latency: 'balanced', normalize: true }
	if (config.voiceId) payload.reference_id = config.voiceId
	const res = await (config.fetch ?? fetch)(FISH_URL, {
		method: 'POST',
		signal,
		headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/msgpack', model: config.model },
		body: encode(payload),
	})
	if (!res.ok || !res.body) {
		const body = await res.text().catch(() => '')
		const reason =
			res.status === 401 || res.status === 403
				? 'Fish Audio rejected the API key.'
				: res.status === 402
					? 'Fish Audio account is out of credit.'
					: res.status === 429
						? 'Fish Audio rate limit reached.'
						: `Fish Audio error ${res.status}: ${body.slice(0, 200)}`
		throw new FishError(res.status, reason)
	}
	return res.body
}
