'use client'
import { atom } from 'tldraw'

/**
 * The tutor's presence on the page. It rests by the student's cursor; while teaching it flies to
 * where it draws (`away`), and goes back to the cursor when the turn ends.
 */
export interface TutorPresence {
	/** Page coordinates of the pen while `away`. */
	x: number
	y: number
	away: boolean
	mode: 'idle' | 'listening' | 'thinking' | 'drawing'
}

export const tutorPresence = atom<TutorPresence>('tutorPresence', { x: 0, y: 0, away: false, mode: 'idle' })

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Fly the tutor to an area before drawing there. */
export async function moveTutorTo(area: { x: number; y: number; w: number; h: number }) {
	const prev = tutorPresence.get()
	const x = area.x + Math.min(area.w, 240) * 0.5
	const y = area.y + Math.min(area.h, 160) * 0.5
	const distance = Math.hypot(x - prev.x, y - prev.y)
	tutorPresence.set({ x, y, away: true, mode: 'drawing' })
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

/** A turn ended (or was stopped): come back to the cursor, unless the student is already talking again. */
export function endTutorTurn() {
	if (tutorPresence.get().mode !== 'listening') setTutorMode('idle')
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
