'use client'
/**
 * Hold-to-talk recording. Recording starts the moment the keys go down (the mic is kept warm
 * between presses) and the clip is transcribed on release: by Fish Audio when the server has a
 * key, otherwise by the browser's own speech recognition, which runs alongside as a fallback.
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

export function startRecording(): Recording {
	const chunks: Blob[] = []
	let recorder: MediaRecorder | null = null
	let stopped = false
	const ready = openMic().then((stream) => {
		if (!stream || stopped || typeof MediaRecorder === 'undefined') return
		const mimeType = pickMime()
		recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
		recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
		recorder.start()
	})
	return {
		async stop() {
			stopped = true
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
export async function transcribe(clip: Blob, timeoutMs = 8000): Promise<string | null> {
	if (!hasFish() && (await within(checkSpeechProvider(), 1500, 'browser' as const)) !== 'fish') return null
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeoutMs)
	try {
		const res = await fetch('/api/transcribe', { method: 'POST', body: clip, headers: { 'Content-Type': clip.type }, signal: controller.signal })
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
	}
}
