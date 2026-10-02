'use client'
import { atom } from 'tldraw'

/** Where the tutor's "pen" is on the page, and what it is doing. */
export interface TutorPresence {
	x: number
	y: number
	visible: boolean
	mode: 'idle' | 'thinking' | 'drawing'
}

export const tutorPresence = atom<TutorPresence>('tutorPresence', { x: 0, y: 0, visible: false, mode: 'idle' })

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Glide the tutor's cursor to an area before drawing there. */
export async function moveTutorTo(area: { x: number; y: number; w: number; h: number }) {
	const prev = tutorPresence.get()
	const x = area.x + Math.min(area.w, 240) * 0.5
	const y = area.y + Math.min(area.h, 160) * 0.5
	const distance = Math.hypot(x - prev.x, y - prev.y)
	tutorPresence.set({ x, y, visible: true, mode: 'drawing' })
	await wait(prev.visible ? Math.min(520, 160 + distance * 0.35) : 120)
}

export function setTutorMode(mode: TutorPresence['mode']) {
	tutorPresence.update((p) => ({ ...p, mode, visible: mode === 'idle' ? false : p.visible }))
}
