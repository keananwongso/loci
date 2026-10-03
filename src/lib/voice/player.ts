'use client'
/**
 * Voice mode playback. Each sentence the tutor says is synthesized as soon as it arrives
 * (Fish Audio through the local /api/speech route) and plays from its first chunk of audio, so
 * the voice starts long before the whole clip is ready. Sentences play in order: playback
 * resolves when the sentence has been said, so the next one never talks over it, while the marks
 * that follow a sentence are drawn as it is spoken.
 * Without a Fish key, or if a request fails, the browser's built-in voice is used instead.
 */
import { toSpoken } from './spoken'
import { measureVoice, setSynthSpeaking } from './level'
import { canSpeak, speak, stopSpeaking } from './speech'

/** Audio as it streams in from the server. */
export interface AudioStream {
	chunks: Uint8Array[]
	finished: boolean
	/** Resolves when more audio arrives or the stream ends. */
	more(): Promise<void>
}

export interface PreparedSpeech {
	/** What is read aloud. */
	spoken: string
	/** Resolves once the first audio has arrived, or null if there is none (use the browser voice). */
	audio: Promise<AudioStream | null>
	controller: AbortController
}

let provider: 'fish' | 'browser' | 'unknown' = 'unknown'
/** Lines with a pre-rendered clip (the demo pack's): played from a static file, never synthesized. */
const staticVoice = new Map<string, string>()

export function registerStaticVoice(clips: Record<string, string>) {
	for (const [text, url] of Object.entries(clips)) staticVoice.set(text.trim(), url)
}

/** Whether a line will play from a pre-rendered clip. */
export const hasStaticVoice = (text: string) => staticVoice.has(text.trim())
let element: HTMLAudioElement | null = null
let stopCurrent: (() => void) | null = null

/** Fish Audio is set up on the server (known once checkSpeechProvider has run). */
export const hasFish = () => provider === 'fish'

export async function checkSpeechProvider(): Promise<'fish' | 'browser'> {
	try {
		const res = await fetch('/api/speech')
		provider = (await res.json()).provider === 'fish' ? 'fish' : 'browser'
	} catch {
		provider = 'browser'
	}
	return provider
}

/** Read a response body into an AudioStream; resolves at the first chunk (null if it never comes). */
function streamAudio(res: Response): Promise<AudioStream | null> {
	const reader = res.body!.getReader()
	let wake = () => {}
	const stream: AudioStream = {
		chunks: [],
		finished: false,
		more: () => new Promise<void>((r) => (wake = r)),
	}
	return new Promise((resolve) => {
		const pump = async () => {
			try {
				for (;;) {
					const { value, done } = await reader.read()
					if (done) break
					if (!value?.byteLength) continue
					stream.chunks.push(value)
					resolve(stream)
					wake()
				}
			} catch {
				// Aborted or cut off: play what arrived.
			}
			stream.finished = true
			resolve(stream.chunks.length ? stream : null)
			wake()
		}
		pump()
	})
}

export function prepareSpeech(text: string): PreparedSpeech {
	const spoken = toSpoken(text)
	const controller = new AbortController()
	const clip = staticVoice.get(text.trim())
	if (clip) {
		const audio = fetch(clip, { signal: controller.signal })
			.then((r) => (r.ok && r.body ? streamAudio(r) : null))
			.catch(() => null)
		return { spoken, audio, controller }
	}
	const audio =
		provider === 'fish' && spoken
			? fetch('/api/speech', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ text: spoken.slice(0, 1500) }),
					signal: controller.signal,
				})
					.then(async (r) => {
						if (r.ok && r.body) return streamAudio(r)
						console.warn('[loci] speech fell back to the browser voice:', (await r.json().catch(() => ({}))).error)
						return null
					})
					.catch(() => null)
			: Promise.resolve(null)
	return { spoken, audio, controller }
}

const timeout = <T>(p: Promise<T>, ms: number, fallback: T) =>
	Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))])

function sharedAudio() {
	if (!element) {
		element = new Audio()
		element.preload = 'auto'
	}
	return element
}

export interface Playback {
	/** Resolves when the voice is actually audible (or speech gave up). */
	started: Promise<void>
	/** Resolves when the sentence has been said, or was stopped. */
	done: Promise<void>
}

/** Play one prepared sentence. Synthesis can take seconds, so `started` and `done` are separate. */
export function playSpeech(p: PreparedSpeech): Playback {
	let markStarted = () => {}
	const started = new Promise<void>((r) => (markStarted = r))
	const done = play(p, markStarted).finally(markStarted)
	return { started, done }
}

async function play(p: PreparedSpeech, onStart: () => void): Promise<void> {
	const stream = await timeout(p.audio, 12000, null)

	if (stream) {
		const audio = sharedAudio()
		measureVoice(audio)
		const source = streamingSource()
		const url = source ? URL.createObjectURL(source) : null
		try {
			const finished = new Promise<void>((resolve) => {
				const done = () => {
					audio.removeEventListener('ended', done)
					audio.removeEventListener('error', done)
					stopCurrent = null
					resolve()
				}
				audio.addEventListener('ended', done)
				audio.addEventListener('error', done)
				stopCurrent = () => {
					audio.pause()
					p.controller.abort()
					done()
				}
			})
			audio.addEventListener('playing', onStart, { once: true })
			let complete: Promise<void>
			if (source && url) {
				// Play from the first chunk while the rest is still arriving.
				audio.src = url
				complete = feed(source, stream)
			} else {
				// No streaming playback in this browser: wait for the whole clip.
				while (!stream.finished) await timeout(stream.more(), 12000, undefined)
				audio.src = URL.createObjectURL(new Blob(stream.chunks as BlobPart[], { type: 'audio/mpeg' }))
				complete = Promise.resolve()
			}
			await audio.play().catch(() => stopCurrent?.())
			await Promise.race([finished, complete.then(() => endsWithin(audio, finished))])
		} finally {
			if (url) URL.revokeObjectURL(url)
			else if (audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src)
		}
		return
	}

	if (!p.spoken || !canSpeak()) return
	const estimate = 1500 + p.spoken.split(/\s+/).length * 450
	setSynthSpeaking(true)
	try {
		await timeout(
			new Promise<void>((resolve) => {
				const done = () => {
					stopCurrent = null
					resolve()
				}
				speak(p.spoken, done, onStart)
				stopCurrent = () => {
					stopSpeaking()
					done()
				}
			}),
			estimate + 4000,
			undefined
		)
	} finally {
		setSynthSpeaking(false)
	}
}

type MediaSourceCtor = typeof MediaSource
/** A MediaSource that can take mp3, when this browser can stream it (Safari has ManagedMediaSource). */
function streamingSource(): MediaSource | null {
	const w = window as unknown as { ManagedMediaSource?: MediaSourceCtor; MediaSource?: MediaSourceCtor }
	const Ctor = w.ManagedMediaSource ?? w.MediaSource
	if (!Ctor?.isTypeSupported?.('audio/mpeg')) return null
	if (Ctor === w.ManagedMediaSource) sharedAudio().disableRemotePlayback = true
	return new Ctor()
}

/** Append audio to the source as it arrives; resolves when all of it is in. */
async function feed(source: MediaSource, stream: AudioStream) {
	if (source.readyState !== 'open') {
		await timeout(new Promise((r) => source.addEventListener('sourceopen', r, { once: true })), 3000, undefined)
	}
	if (source.readyState !== 'open') return
	const buffer = source.addSourceBuffer('audio/mpeg')
	const appended = () => new Promise((r) => buffer.addEventListener('updateend', r, { once: true }))
	let sent = 0
	try {
		for (;;) {
			if (sent < stream.chunks.length) {
				const batch = stream.chunks.slice(sent)
				sent = stream.chunks.length
				const bytes = new Uint8Array(batch.reduce((n, c) => n + c.byteLength, 0))
				let at = 0
				for (const c of batch) {
					bytes.set(c, at)
					at += c.byteLength
				}
				buffer.appendBuffer(bytes)
				await appended()
				continue
			}
			if (stream.finished) break
			// A stream that stalls this long is not coming back; play what arrived.
			if ((await timeout(stream.more().then(() => true), 12000, false)) === false) break
		}
		if (source.readyState === 'open' && !buffer.updating) source.endOfStream()
	} catch (err) {
		console.warn('[loci] streaming audio failed', err)
		if (source.readyState === 'open') source.endOfStream()
	}
}

/** Once all the audio is in, `finished` (the ended event) should follow within the remaining time. */
function endsWithin(audio: HTMLAudioElement, finished: Promise<void>) {
	const left = Number.isFinite(audio.duration) ? Math.max(0, audio.duration - audio.currentTime) : 30
	return timeout(finished, left * 1000 + 3000, undefined)
}

export function stopAllSpeech() {
	stopCurrent?.()
	stopCurrent = null
	stopSpeaking()
	setSynthSpeaking(false)
}
