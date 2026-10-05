'use client'
import type { Editor } from 'tldraw'
import type { Rect } from './placement'

/** The part of the screen not covered by Loci's floating UI (toolbar, top bar, answer dock). */
export function safeScreenArea(editor: Editor): Rect {
	const vp = editor.getViewportScreenBounds()
	const dock = typeof document !== 'undefined' ? document.querySelector('.loci-dock')?.getBoundingClientRect() : undefined
	const top = 72
	const left = vp.w > 700 ? 76 : 16
	const bottom = dock ? Math.max(24, vp.y + vp.h - dock.top + 16) : 120
	return { x: left, y: top, w: Math.max(200, vp.w - left - 24), h: Math.max(160, vp.h - top - bottom) }
}

/**
 * True if a page-space rect is fully visible inside the safe area, at a zoom where it can be read.
 * A student who zoomed out to see the whole board "sees" everything, but can read none of it.
 */
export function isFramed(editor: Editor, area: Rect): boolean {
	if (editor.getZoomLevel() < MIN_READABLE_ZOOM - 0.01) return false
	const safe = safeScreenArea(editor)
	const a = editor.pageToViewport({ x: area.x, y: area.y })
	const b = editor.pageToViewport({ x: area.x + area.w, y: area.y + area.h })
	return a.x >= safe.x && a.y >= safe.y && b.x <= safe.x + safe.w && b.y <= safe.y + safe.h
}

/** Zoom needed to show `area` (plus padding) inside the safe area, capped at 100%. */
export function fitZoom(editor: Editor, area: Rect, pad = 40): number {
	const safe = safeScreenArea(editor)
	return Math.min(1, safe.w / (area.w + pad * 2), safe.h / (area.h + pad * 2))
}

/** Below this the tutor's handwriting and the notes' text are too small to read. */
export const MIN_READABLE_ZOOM = 0.45

/**
 * Animate the camera so `area` is centred in the part of the screen the student can see. Never
 * zooms out past readable: an area too big for that (things spread across a busy board) is shown
 * from its top-left corner, where reading starts, instead of shrinking everything to specks.
 */
export function frameArea(editor: Editor, area: Rect, opts: { pad?: number; duration?: number } = {}) {
	const safe = safeScreenArea(editor)
	const pad = opts.pad ?? 40
	const fit = fitZoom(editor, area, pad)
	const z = Math.max(MIN_READABLE_ZOOM, fit)
	// tldraw: screen = (page + camera) * zoom
	const cx = (area.w + pad * 2) * z <= safe.w ? area.x + area.w / 2 : area.x - pad + safe.w / z / 2
	const cy = (area.h + pad * 2) * z <= safe.h ? area.y + area.h / 2 : area.y - pad + safe.h / z / 2
	const sx = safe.x + safe.w / 2
	const sy = safe.y + safe.h / 2
	editor.setCamera({ x: sx / z - cx, y: sy / z - cy, z }, { animation: { duration: opts.duration ?? 520 } })
}
