'use client'
import { atom } from '@/lib/whiteboard'

/**
 * The tutor's presence on the page. It rests by the student's cursor; while teaching it flies to
 * where it draws (`away`), and goes back to the cursor when the turn ends.
 */
export interface TutorPresence {
	/** Page coordinates of the pen while `away`. */
	x: number
	y: number
	away: boolean
	mode: 'idle' | 'listening' | 'transcribing' | 'thinking' | 'drawing'
	/** What it is looking at or about to draw on: it hovers beside this, not on top of it. */
	beside?: { x: number; y: number; w: number; h: number }
}

export const tutorPresence = atom<TutorPresence>('tutorPresence', { x: 0, y: 0, away: false, mode: 'idle' })

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Fly the tutor to an area before drawing there. */
export async function moveTutorTo(area: { x: number; y: number; w: number; h: number }) {
	const prev = tutorPresence.get()
	const x = area.x + Math.min(area.w, 240) * 0.5
	const y = area.y + Math.min(area.h, 160) * 0.5
	const distance = Math.hypot(x - prev.x, y - prev.y)
	tutorPresence.set({ x, y, away: true, mode: 'drawing', beside: area })
	await wait(prev.away ? Math.min(520, 160 + distance * 0.35) : 360)
}

/** Move the pen along a line of writing, left to right, over `ms`. */
export async function penAlong(area: { x: number; y: number; w: number; h: number }, ms: number) {
	const y = area.y + area.h * 0.6
	tutorPresence.set({ x: area.x, y, away: true, mode: 'drawing' })
	const start = performance.now()
	const glide = new Promise<void>((resolve) => {
		const step = () => {
			const k = Math.min(1, (performance.now() - start) / ms)
			tutorPresence.update((p) => ({ ...p, x: area.x + area.w * k, y }))
			if (k < 1) requestAnimationFrame(step)
			else resolve()
		}
		requestAnimationFrame(step)
	})
	// Animation frames stop in a background tab; the writing must not stall the turn.
	await Promise.race([glide, wait(ms + 150)])
}

/** A turn ended: leave a newer recording or transcription alone. */
export function endTutorTurn() {
	clearThinking()
	if (!['listening', 'transcribing'].includes(tutorPresence.get().mode)) setTutorMode('idle')
}

export function setTutorMode(mode: TutorPresence['mode']) {
	tutorPresence.update((p) => ({ ...p, mode, away: mode === 'idle' || mode === 'listening' ? false : p.away }))
}

/** What the student has said so far while holding to talk, shown under the buddy. */
export const heard = atom<string>('heard', '')

/** The hold-to-talk keys, named for this platform. */
export function talkKeysLabel() {
	if (typeof navigator === 'undefined') return 'Ctrl + Alt'
	return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌃ + ⌥' : 'Ctrl + Alt'
}

/** A short line under the buddy saying what it is doing ("Thinking…"); empty hides it. */
export const buddyStatus = atom<string>('buddyStatus', '')

let statusTimer: ReturnType<typeof setTimeout> | undefined
export function setBuddyStatus(text: string, clearAfterMs?: number) {
	clearTimeout(statusTimer)
	buddyStatus.set(text)
	if (clearAfterMs) statusTimer = setTimeout(() => buddyStatus.set(''), clearAfterMs)
}

/** Fly over to what the student pointed at and look at it while thinking. */
export function lookAt(area: { x: number; y: number; w: number; h: number } | null) {
	if (!area) return setTutorMode('thinking')
	tutorPresence.set({ x: area.x + area.w / 2, y: area.y + Math.min(area.h, 160) / 2, away: true, mode: 'thinking', beside: area })
}

/**
 * While the tutor works on a question: what it heard (`asked`, spoken questions only) and one
 * line saying what it is doing (`thought`), both beside the buddy. They fold away the moment the
 * answer starts (first words heard, or first mark drawn).
 */
export interface BuddyThought {
	text: string
	latex?: string
}
export const buddyThought = atom<BuddyThought | null>('buddyThought', null)
export const buddyAsked = atom<string>('buddyAsked', '')

export function setThought(thought: BuddyThought | null) {
	buddyThought.set(thought)
}

export function showAsked(text: string) {
	buddyAsked.set(text)
}

/** The answer has started (or the turn ended): put the thinking away. */
export function clearThinking() {
	buddyThought.set(null)
	buddyAsked.set('')
}

/**
 * A soft pulse around what the tutor is talking about (not a shape: it never touches the board or
 * its undo history). `key` restarts the animation when the same spot is pointed at again.
 */
export const emphasis = atom<{ area: { x: number; y: number; w: number; h: number }; key: number } | null>('emphasis', null)

let emphasisTimer: ReturnType<typeof setTimeout> | undefined
export function emphasize(area: { x: number; y: number; w: number; h: number }, ms = 2600) {
	clearTimeout(emphasisTimer)
	emphasis.set({ area, key: performance.now() })
	emphasisTimer = setTimeout(() => emphasis.set(null), ms)
}

/** Look at something already on the board while talking about it. */
export function lookAtWhileTalking(area: { x: number; y: number; w: number; h: number }) {
	moveTutorTo(area)
	emphasize(area)
}
