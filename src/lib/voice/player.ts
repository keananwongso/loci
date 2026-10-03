'use client'
/**
 * Voice mode playback. Each sentence the tutor says is synthesized as soon as it arrives
 * (Fish Audio through the local /api/speech route), then played in order. Playback resolves when
 * the sentence has been said, so the next sentence never talks over it, while the marks that
 * follow a sentence are drawn as it is spoken.
 * Without a Fish key, or if a request fails, the browser's built-in voice is used instead.
 */
import { toSpoken } from './spoken'
import { measureVoice, setSynthSpeaking } from './level'
import { canSpeak, speak, stopSpeaking } from './speech'

export interface PreparedSpeech {
	/** What is read aloud. */
	spoken: string
	audio: Promise<Blob | null>
	controller: AbortController
}

let provider: 'fish' | 'browser' | 'unknown' = 'unknown'
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

export function prepareSpeech(text: string): PreparedSpeech {
	const spoken = toSpoken(text)
	const controller = new AbortController()
	const audio =
		provider === 'fish' && spoken
			? fetch('/api/speech', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ text: spoken.slice(0, 1500) }),
					signal: controller.signal,
				})
					.then(async (r) => {
						if (r.ok) return r.blob()
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
	const blob = await timeout(p.audio, 12000, null)

	if (blob) {
		const audio = sharedAudio()
		measureVoice(audio)
		const url = URL.createObjectURL(blob)
		try {
			audio.src = url
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
					done()
				}
			})
			audio.addEventListener('playing', onStart, { once: true })
			await audio.play().catch(() => stopCurrent?.())
			const seconds = Number.isFinite(audio.duration) ? audio.duration : 30
			await timeout(finished, seconds * 1000 + 3000, undefined)
		} finally {
			URL.revokeObjectURL(url)
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

export function stopAllSpeech() {
	stopCurrent?.()
	stopCurrent = null
	stopSpeaking()
	setSynthSpeaking(false)
}
