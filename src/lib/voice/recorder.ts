'use client'
/**
 * Hold-to-talk recording. Recording starts the moment the keys go down (the mic is kept warm
 * between presses). Two bounded Fish previews provide live text when browser recognition is
 * unavailable; the complete clip is transcribed on release. All previews use the normal quotas.
 */
import { openMic, releaseMic } from './level'
import { checkSpeechProvider, hasFish } from './player'

export interface Recording {
	/** Stop and return the recorded clip (null if the mic never opened). */
	stop(): Promise<Blob | null>
}

function pickMime() {
	for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
		if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t
	}
	return undefined
}

/** `p`, or `fallback` if it takes longer than `ms`. Nothing in hold-to-talk may hang. */
export const within = <T>(p: Promise<T>, ms: number, fallback: T) =>
	Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))])

export function startRecording(onInterim?: (text: string) => void, hasBrowserWords: () => boolean = () => false): Recording {
	const chunks: Blob[] = []
	let recorder: MediaRecorder | null = null
	let stopped = false
	let previewPending = false
	let previews = 0
	let lastPreview = 0
	let previewController: AbortController | undefined
	const ready = openMic().then((stream) => {
		if (!stream || stopped || typeof MediaRecorder === 'undefined') return
		const mimeType = pickMime()
		recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
		recorder.ondataavailable = (e) => {
			if (e.data.size) chunks.push(e.data)
			if (!onInterim || stopped || previewPending || previews >= 2 || hasBrowserWords() || performance.now() - lastPreview < 1500) return
			const clip = new Blob(chunks, { type: recorder!.mimeType || 'audio/webm' })
			if (clip.size < 3000 || clip.size > MAX_PREVIEW_BYTES) return
			previewPending = true
			previews++
			lastPreview = performance.now()
			previewController = new AbortController()
			void transcribe(clip, 4000, previewController.signal).then((text) => {
				if (!stopped && !hasBrowserWords() && text) onInterim(text)
			}).finally(() => { previewPending = false })
		}
		recorder.start(500)
	})
	return {
		async stop() {
			stopped = true
			previewController?.abort()
			// A mic that is still opening (or waiting on a permission prompt) must not block the question.
			await within(ready, 1500, undefined)
			releaseMic()
			const r = recorder as MediaRecorder | null
			if (!r) {
				console.info('[loci] hold to talk: the mic was not ready, so nothing was recorded')
				return null
			}
			if (r.state !== 'inactive') {
				await within(
					new Promise<void>((resolve) => {
						r.onstop = () => resolve()
						r.stop()
					}),
					1500,
					undefined
				)
			}
			return chunks.length ? new Blob(chunks, { type: r.mimeType || 'audio/webm' }) : null
		},
	}
}

/** Fish Audio transcript of a clip, or null when transcription is unavailable or fails. */
export async function transcribe(clip: Blob, timeoutMs = 8000, signal?: AbortSignal): Promise<string | null> {
	if (!hasFish() && (await within(checkSpeechProvider(), 1500, 'browser' as const)) !== 'fish') return null
	const controller = new AbortController()
	const abort = () => controller.abort()
	if (signal?.aborted) return null
	signal?.addEventListener('abort', abort, { once: true })
	const timer = setTimeout(() => controller.abort(), timeoutMs)
	try {
		// Browsers record webm, mp4 or ogg; Fish reliably decodes plain WAV, so send that when possible.
		const audio = (await within(toWav(clip), 2000, null)) ?? clip
		if (controller.signal.aborted) return null
		const res = await fetch('/api/transcribe', { method: 'POST', body: audio, headers: { 'Content-Type': audio.type }, signal: controller.signal })
		if (!res.ok) {
			console.warn('[loci] Fish transcription failed:', (await res.json().catch(() => ({}))).error ?? res.status)
			return null
		}
		const { text } = (await res.json()) as { text?: string }
		return text?.trim() || null
	} catch {
		return null
	} finally {
		clearTimeout(timer)
		signal?.removeEventListener('abort', abort)
	}
}

const WAV_RATE = 16000
const MAX_PREVIEW_BYTES = 400_000

/** The clip as 16 kHz mono 16-bit WAV, or null if this browser can't decode it. */
export async function toWav(clip: Blob): Promise<Blob | null> {
	try {
		const decoded = await new OfflineAudioContext(1, 1, WAV_RATE).decodeAudioData(await clip.arrayBuffer())
		// Render through a mono context at the target rate: this downmixes and resamples in one pass.
		const ctx = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * WAV_RATE)), WAV_RATE)
		const source = ctx.createBufferSource()
		source.buffer = decoded
		source.connect(ctx.destination)
		source.start()
		const samples = (await ctx.startRendering()).getChannelData(0)
		const out = new DataView(new ArrayBuffer(44 + samples.length * 2))
		const text = (at: number, s: string) => [...s].forEach((c, i) => out.setUint8(at + i, c.charCodeAt(0)))
		text(0, 'RIFF')
		out.setUint32(4, 36 + samples.length * 2, true)
		text(8, 'WAVE')
		text(12, 'fmt ')
		out.setUint32(16, 16, true)
		out.setUint16(20, 1, true) // PCM
		out.setUint16(22, 1, true) // mono
		out.setUint32(24, WAV_RATE, true)
		out.setUint32(28, WAV_RATE * 2, true)
		out.setUint16(32, 2, true)
		out.setUint16(34, 16, true)
		text(36, 'data')
		out.setUint32(40, samples.length * 2, true)
		for (let i = 0; i < samples.length; i++) {
			const v = Math.max(-1, Math.min(1, samples[i]))
			out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true)
		}
		return new Blob([out.buffer], { type: 'audio/wav' })
	} catch (err) {
		console.warn('[loci] could not convert the recording to WAV; sending it as recorded', err)
		return null
	}
}
