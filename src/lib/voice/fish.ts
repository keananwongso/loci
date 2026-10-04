import { cleanVoiceTranscript } from './transcript'
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
	/** Optional speaking rate override; omitted uses Fish's natural pace. */
	speed?: number
	/** Optional sampling override; omitted uses Fish's default delivery. */
	temperature?: number
	/** Optional latency override; omitted uses Fish's default quality. */
	latency?: 'normal' | 'balanced'
	fetch?: typeof fetch
}

const num = (v: string | undefined, min: number, max: number) => {
	const n = Number.parseFloat(v ?? '')
	return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined
}

export function fishConfigFromEnv(env: NodeJS.ProcessEnv = process.env): FishConfig {
	return {
		apiKey: env.FISH_API_KEY || undefined,
		model: env.LOCI_TTS_MODEL || 's2-pro',
		voiceId: env.FISH_VOICE_ID || undefined,
		speed: num(env.LOCI_TTS_SPEED, 0.5, 2),
		temperature: num(env.LOCI_TTS_TEMPERATURE, 0, 1),
		latency: env.LOCI_TTS_LATENCY === 'normal' || env.LOCI_TTS_LATENCY === 'balanced' ? env.LOCI_TTS_LATENCY : undefined,
	}
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
	const payload: Record<string, unknown> = {
		text,
		format: 'mp3',
	}
	// Leave delivery controls out unless explicitly configured, so Fish applies its defaults.
	if (config.latency !== undefined) payload.latency = config.latency
	if (config.temperature !== undefined) payload.temperature = config.temperature
	if (config.speed !== undefined) payload.prosody = { speed: config.speed }
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

export const FISH_ASR_URL = 'https://api.fish.audio/v1/asr'
/** About a minute of compressed speech; a hold-to-talk question is a few seconds. */
export const MAX_RECORDING_BYTES = 2_000_000

/** Transcribe a recorded question. Returns the text (possibly empty). */
export async function fishTranscribe(audio: Blob, config: FishConfig, signal?: AbortSignal): Promise<string> {
	if (!config.apiKey) throw new FishError(503, 'FISH_API_KEY is not set.')
	const form = new FormData()
	form.append('audio', audio, `question.${extensionFor(audio.type)}`)
	form.append('ignore_timestamps', 'true')
	// Loci teaches in English. Left to auto-detect, a short or mumbled clip can come back as
	// another language (Chinese, for one), and the model then answers in it.
	form.append('language', 'en')
	const res = await (config.fetch ?? fetch)(FISH_ASR_URL, {
		method: 'POST',
		signal,
		headers: { Authorization: `Bearer ${config.apiKey}` },
		body: form,
	})
	if (!res.ok) {
		const body = await res.text().catch(() => '')
		throw new FishError(res.status, `Fish Audio transcription error ${res.status}: ${body.slice(0, 200)}`)
	}
	const data = (await res.json()) as { text?: string }
	return cleanVoiceTranscript(data.text ?? '')
}

/** A file name extension Fish can recognise the format by. */
function extensionFor(type: string) {
	if (type.includes('wav')) return 'wav'
	if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) return 'm4a'
	if (type.includes('ogg')) return 'ogg'
	if (type.includes('mpeg') || type.includes('mp3')) return 'mp3'
	return 'webm'
}
