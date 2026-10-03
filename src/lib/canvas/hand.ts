'use client'
/**
 * The tutor writes by hand: its notes use tldraw's handwriting font (Shantell Sans, served from
 * this app), and so do the letters and numbers inside its equations. New writing is revealed
 * left to right as the pen moves across it.
 */
import { penAlong } from './presence'

export const HAND_FAMILY = 'loci-hand'

let loading: Promise<void> | null = null

/** Register the handwriting font once, from the self-hosted tldraw asset. */
export function loadHandFont(url: string | undefined): Promise<void> {
	if (typeof document === 'undefined' || !url) return Promise.resolve()
	loading ??= (async () => {
		try {
			const face = new FontFace(HAND_FAMILY, `url(${url})`)
			document.fonts.add(face)
			await face.load()
		} catch (err) {
			console.warn('[loci] could not load the handwriting font', err)
		}
	})()
	return loading
}

/** Resolves once the font is ready (or failed), so measurements use the real glyphs. */
export function handFontReady(): Promise<void> {
	return loading ?? Promise.resolve()
}

/** About how long a pen takes to write this much, in ms. */
export function writingTime(chars: number) {
	return Math.max(380, Math.min(1800, chars * 55))
}

/**
 * Reveal a freshly created shape left to right over `ms` while the tutor's pen moves along it.
 * Works for any shape (native tldraw text included) by styling its DOM node by id.
 */
export async function writeIn(shapeId: string, area: { x: number; y: number; w: number; h: number }, ms: number) {
	if (typeof document === 'undefined') return
	const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
	if (reduce) return
	const style = document.createElement('style')
	const sel = `.tl-shape[data-shape-id="${CSS.escape(shapeId)}"]`
	style.textContent = `${sel} > * { animation: loci-write ${ms}ms linear both; }`
	document.head.appendChild(style)
	try {
		await penAlong(area, ms)
	} finally {
		setTimeout(() => style.remove(), 120)
	}
}
