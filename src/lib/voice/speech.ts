'use client'
/**
 * Push-to-talk and read-aloud using the browser's built-in speech APIs.
 * Note: in some browsers (e.g. Chrome) speech recognition is processed by the browser
 * vendor's servers. Speech synthesis uses voices installed on the device.
 */
import { speakable } from '@/lib/canvas/richtext'

interface RecognitionLike {
	lang: string
	interimResults: boolean
	continuous: boolean
	start(): void
	stop(): void
	abort(): void
	onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
	onerror: ((e: { error: string }) => void) | null
	onend: (() => void) | null
}

function getRecognitionCtor(): (new () => RecognitionLike) | null {
	if (typeof window === 'undefined') return null
	const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike }
	return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const canRecognize = () => getRecognitionCtor() !== null
export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window

/** Start listening; returns a function that stops and resolves with the final transcript. */
export function startListening(onInterim: (text: string) => void, onError: (msg: string) => void) {
	const Ctor = getRecognitionCtor()
	if (!Ctor) {
		onError('Voice input is not supported in this browser.')
		return async () => ''
	}
	const rec = new Ctor()
	rec.lang = navigator.language || 'en-US'
	rec.interimResults = true
	rec.continuous = true
	let finalText = ''
	let interim = ''
	rec.onresult = (e) => {
		interim = ''
		for (let i = e.resultIndex; i < e.results.length; i++) {
			const r = e.results[i]
			if (r.isFinal) finalText += r[0].transcript
			else interim += r[0].transcript
		}
		onInterim((finalText + interim).trim())
	}
	rec.onerror = (e) => {
		if (e.error !== 'aborted' && e.error !== 'no-speech') onError(`Voice input error: ${e.error}`)
	}
	let ended: () => void = () => {}
	const done = new Promise<void>((resolve) => (ended = resolve))
	rec.onend = () => ended()
	rec.start()
	return async () => {
		rec.stop()
		await Promise.race([done, new Promise((r) => setTimeout(r, 1500))])
		return (finalText + interim).trim()
	}
}

let preferred: SpeechSynthesisVoice | null = null
function pickVoice() {
	if (preferred || !canSpeak()) return preferred
	const voices = speechSynthesis.getVoices()
	const lang = (navigator.language || 'en').slice(0, 2)
	preferred =
		voices.find((v) => v.lang.startsWith(lang) && v.localService && /natural|premium|enhanced|samantha|daniel/i.test(v.name)) ??
		voices.find((v) => v.lang.startsWith(lang) && v.localService) ??
		voices.find((v) => v.lang.startsWith(lang)) ??
		null
	return preferred
}

export function speak(text: string) {
	if (!canSpeak()) return
	const u = new SpeechSynthesisUtterance(speakable(text))
	const voice = pickVoice()
	if (voice) u.voice = voice
	u.rate = 1.02
	speechSynthesis.speak(u)
}

export function stopSpeaking() {
	if (canSpeak()) speechSynthesis.cancel()
}
