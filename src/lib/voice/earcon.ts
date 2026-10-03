'use client'
/**
 * Hold-to-talk earcons: a short rising blip when the keys go down ("I'm listening") and a softer
 * falling one when they come up ("got it"). Synthesized on the spot, so they play instantly with
 * no files to load. Every note fades in and out, so there is no click at either end.
 */
import { audioContext } from './level'

function note(ctx: AudioContext, at: number, from: number, to: number, ms: number, gain: number) {
	const osc = ctx.createOscillator()
	const amp = ctx.createGain()
	osc.type = 'sine'
	osc.frequency.setValueAtTime(from, at)
	osc.frequency.exponentialRampToValueAtTime(to, at + ms / 1000)
	amp.gain.setValueAtTime(0, at)
	amp.gain.linearRampToValueAtTime(gain, at + 0.008)
	amp.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000)
	osc.connect(amp).connect(ctx.destination)
	osc.start(at)
	osc.stop(at + ms / 1000 + 0.02)
}

function play(fn: (ctx: AudioContext, t: number) => void) {
	try {
		const ctx = audioContext()
		fn(ctx, ctx.currentTime + 0.005)
	} catch {
		// No audio: the visual cues still show.
	}
}

/** Keys down: start listening. */
export function listenStartSound() {
	play((ctx, t) => {
		note(ctx, t, 620, 660, 70, 0.07)
		note(ctx, t + 0.065, 880, 940, 90, 0.07)
	})
}

/** Keys up: question taken. */
export function listenEndSound() {
	play((ctx, t) => {
		note(ctx, t, 900, 700, 110, 0.055)
	})
}
