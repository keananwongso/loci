'use client'
/**
 * The tutor's "let me look": a short, fixed phrase spoken while the model works on a real question,
 * fitting what the student pointed at. Small talk, thanks and answers to the tutor's own question
 * get none (the release blip already says "heard you"), so "hi" is never met with "one sec".
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

const SOCIAL = /^(hi|hey|hello|hiya|yo|sup|thanks|thank you|thx|ok|okay|cool|nice|great|got it|i see|yes|yeah|yep|no|nope|sure|right|good (morning|afternoon|evening))\b/

/**
 * Whether a question deserves a spoken "let me look": a real request, not small talk, thanks, a
 * one or two word reply, or the student answering the question the tutor just asked.
 */
export function wantsAck(question: string, lastSaid?: string): boolean {
	const q = question.toLowerCase().trim()
	const words = q.split(/\s+/).filter(Boolean)
	if (words.length < 4) return false
	if (SOCIAL.test(q) && words.length <= 8) return false
	if (lastSaid?.trim().endsWith('?')) return false
	return true
}
