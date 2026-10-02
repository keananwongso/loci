'use client'
/**
 * Voice mode playback. Each sentence the tutor says is synthesized as soon as it arrives
 * (Fish Audio through the local /api/speech route), then played in order through the speaking
 * orb. Playback is awaited, so the drawing queue continues once the sentence has been said.
 * Without a Fish key, or if a request fails, the browser's built-in voice is used instead.
 */
import { latexToPlain } from '@/lib/canvas/katex'
import { speakable } from '@/lib/canvas/richtext'
import { getOrb, type OrbWord } from './orb'
import { canSpeak, speak, stopSpeaking } from './speech'

export interface PreparedSpeech {
	/** What is read aloud. */
	spoken: string
	/** What the captions show. */
	caption: string
	audio: Promise<Blob | null>
	controller: AbortController
}

let provider: 'fish' | 'browser' | 'unknown' = 'unknown'
let element: HTMLAudioElement | null = null
let stopCurrent: (() => void) | null = null

export async function checkSpeechProvider(): Promise<'fish' | 'browser'> {
	try {
		const res = await fetch('/api/speech')
		provider = (await res.json()).provider === 'fish' ? 'fish' : 'browser'
	} catch {
		provider = 'browser'
	}
	return provider
}

const SUB: Record<string, string> = { a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ', '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' }
const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', n: 'ⁿ', '*': '*' }

/** LaTeX to caption text: symbols plus unicode sub/superscripts where they exist (D_u f -> Dᵤ f). */
export function mathCaption(latex: string): string {
	const scripted = latex
		.replace(/_\{?([a-z0-9])\}?/gi, (m, c: string) => SUB[c.toLowerCase()] ?? c)
		.replace(/\^\{?([0-9n*])\}?/g, (m, c: string) => SUP[c] ?? c)
	return latexToPlain(scripted).replace(/\s*([·=⇒≤≥])\s*/g, ' $1 ')
}

/** Captions: readable plain text with math turned into symbols (∇f · u). */
function captionText(text: string) {
	return text
		.replace(/\$\$?([^$]+)\$\$?/g, (_, m: string) => mathCaption(m))
		.replace(/[*`]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
}

export function prepareSpeech(text: string): PreparedSpeech {
	const spoken = speakable(text)
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
	return { spoken, caption: captionText(text), audio, controller }
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

/** Caption timings spread across the real audio length. */
function scaledWords(caption: string, duration: number): OrbWord[] | undefined {
	const orb = getOrb()
	if (!orb || !Number.isFinite(duration) || duration <= 0) return undefined
	const words = orb.estimate(caption.split(/\s+/).filter(Boolean), 0)
	const end = words.at(-1)?.end ?? 0
	if (!end) return undefined
	const k = (duration * 0.96) / end
	return words.map((w) => ({ w: w.w, start: w.start * k, end: w.end * k }))
}

/** Play one prepared sentence; resolves when it has finished (or was stopped). */
export async function playSpeech(p: PreparedSpeech): Promise<void> {
	const blob = await timeout(p.audio, 12000, null)
	const orb = getOrb()

	if (blob) {
		const audio = sharedAudio()
		const url = URL.createObjectURL(blob)
		try {
			audio.src = url
			await timeout(
				new Promise<void>((r) => audio.addEventListener('loadedmetadata', () => r(), { once: true })),
				4000,
				undefined
			)
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
			if (orb) orb.say(p.caption, { audio, words: scaledWords(p.caption, audio.duration) })
			else await audio.play()
			await timeout(finished, (Number.isFinite(audio.duration) ? audio.duration : 30) * 1000 + 3000, undefined)
		} finally {
			URL.revokeObjectURL(url)
		}
		return
	}

	if (!p.spoken || !canSpeak()) return
	// Browser voice. The orb drives speechSynthesis itself and fires `end` when done.
	const estimate = 1500 + p.spoken.split(/\s+/).length * 450
	await timeout(
		new Promise<void>((resolve) => {
			if (orb) {
				const done = () => {
					orb.removeEventListener('end', done)
					stopCurrent = null
					resolve()
				}
				orb.addEventListener('end', done)
				stopCurrent = () => {
					stopSpeaking()
					done()
				}
				orb.say(p.spoken)
			} else {
				speak(p.spoken)
				stopCurrent = () => {
					stopSpeaking()
					resolve()
				}
				setTimeout(resolve, estimate)
			}
		}),
		estimate + 4000,
		undefined
	)
}

export function stopAllSpeech() {
	stopCurrent?.()
	stopCurrent = null
	stopSpeaking()
}
