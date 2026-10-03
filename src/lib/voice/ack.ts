'use client'
/**
 * The tutor's instant "I heard you": a short, fixed phrase spoken the moment the student lets go
 * of the talk keys, before the words are even transcribed. The phrase fits what they pointed at.
 * All phrases are synthesized when voice mode turns on, so playing one costs nothing and starts
 * immediately.
 */
import { playSpeech, prepareSpeech, type Playback, type PreparedSpeech } from './player'

/** What the student pointed at when they asked. */
export type AckKind = 'part' | 'graph' | 'object' | 'none'

const PHRASES: Record<AckKind, string[]> = {
	part: ['Okay, looking at this.', 'Let me look at that part.', 'Got it, this bit here.'],
	graph: ['Let me look at your graph.', 'Okay, looking at the graph.', 'Got it, the graph.'],
	object: ['Okay, let me look.', 'Got it. Let me see.', 'Alright, looking at this.'],
	none: ['Hmm, one sec.', 'Okay, let me think.', 'Sure, let me see.'],
}

const KINDS = Object.keys(PHRASES) as AckKind[]
let prepared: Partial<Record<AckKind, PreparedSpeech[]>> = {}
const next: Record<AckKind, number> = { part: 0, graph: 0, object: 0, none: 0 }
/** The acknowledgement just played on release, waiting for the question it belongs to. */
let pending: { playback: Playback; at: number } | null = null

/**
 * Synthesize the phrases ahead of time (call after the speech provider is known). The first
 * phrase of each kind goes first, the rest follow two at a time, so the API isn't flooded.
 */
export function warmAcks() {
	if (prepared.part) return
	prepared = Object.fromEntries(KINDS.map((k) => [k, []]))
	for (const k of KINDS) prepared[k]!.push(prepareSpeech(PHRASES[k][0]))
	const rest = KINDS.flatMap((k) => PHRASES[k].slice(1).map((text) => ({ k, text })))
	const lane = async () => {
		for (let job = rest.shift(); job; job = rest.shift()) {
			const p = prepareSpeech(job.text)
			prepared[job.k]!.push(p)
			await p.audio
		}
	}
	Promise.all(KINDS.map((k) => prepared[k]![0].audio)).then(() => Promise.all([lane(), lane()]))
}

/** Say an acknowledgement that fits what the student pointed at. */
export function playAck(kind: AckKind = 'object'): Playback {
	warmAcks()
	const list = prepared[kind]!
	const p = list[next[kind]++ % list.length]
	return playSpeech(p)
}

/** Acknowledge the instant the talk keys come up; the question that follows picks it up with takeAck. */
export function ackRelease(kind: AckKind) {
	pending = { playback: playAck(kind), at: performance.now() }
}

/** The acknowledgement already playing for this question, if it was played in the last few seconds. */
export function takeAck(): Playback | null {
	const p = pending
	pending = null
	return p && performance.now() - p.at < 15000 ? p.playback : null
}
