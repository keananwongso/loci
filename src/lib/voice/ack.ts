'use client'
/**
 * The tutor's instant "I heard you": a short, fixed phrase spoken the moment a question is sent,
 * while the model is still thinking. The phrases are synthesized once when voice mode turns on,
 * so playing one costs nothing and starts immediately.
 */
import { playSpeech, prepareSpeech, type Playback, type PreparedSpeech } from './player'

const PHRASES = ['Okay, let me look.', 'Hmm, one sec.', 'Got it. Let me see.', 'Alright, let me think.']

let prepared: PreparedSpeech[] = []
let next = 0

/** Synthesize the phrases ahead of time (call after the speech provider is known). */
export function warmAcks() {
	if (!prepared.length) prepared = PHRASES.map(prepareSpeech)
}

/** Say the next acknowledgement. */
export function playAck(): Playback {
	warmAcks()
	const p = prepared[next++ % prepared.length]
	return playSpeech(p)
}
