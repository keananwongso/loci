'use client'
/** Thin typed handle on the <speaking-orb> custom element (public/vendor/speaking-orb.js). */

export type OrbState = 'listening' | 'thinking' | 'searching' | 'speaking' | 'done'
export interface OrbWord {
	w: string
	start: number
	end: number
}
export interface SpeakingOrbElement extends HTMLElement {
	state: OrbState
	say(text: string, opts?: { audio?: HTMLAudioElement; words?: OrbWord[]; voice?: SpeechSynthesisVoice }): void
	listen(stream?: MediaStream): Promise<() => void>
	estimate(tokens: string[], t: number): OrbWord[]
}

let orb: SpeakingOrbElement | null = null
let loading: Promise<void> | null = null

export function registerOrb(el: SpeakingOrbElement | null) {
	orb = el
}

export function getOrb() {
	return orb
}

export function setOrbState(state: OrbState) {
	if (orb) orb.state = state
}

/** Load the orb script once (a local file; no network beyond this app). */
export function loadOrbScript(): Promise<void> {
	if (typeof window === 'undefined') return Promise.resolve()
	if (customElements.get('speaking-orb')) return Promise.resolve()
	loading ??= new Promise((resolve, reject) => {
		const s = document.createElement('script')
		s.src = '/vendor/speaking-orb.js'
		s.async = true
		s.onload = () => customElements.whenDefined('speaking-orb').then(() => resolve())
		s.onerror = () => reject(new Error('Could not load the speaking orb'))
		document.head.appendChild(s)
	})
	return loading
}

/** Live mic level for the orb while the student holds to talk. */
let stopMic: (() => void) | null = null
export async function orbListen() {
	if (!orb) return
	try {
		stopMic = await orb.listen()
	} catch {
		stopMic = null
	}
}
export function orbStopListening() {
	stopMic?.()
	stopMic = null
}
