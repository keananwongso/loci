'use client'
/**
 * The tutor writes by hand: its notes use Shantell Sans handwriting font (Shantell Sans, served from
 * this app), and so do the letters and numbers inside its equations. New writing is revealed
 * left to right as the pen moves across it.
 */
import { getSpeechTransport, subscribeSpeechTransport } from '@/lib/voice/transport'
import { penAlong } from './presence'
import { lineClip, type WritingLine } from './writing-layout'

export const HAND_FAMILY = 'Shantell Sans'

type WritingObserver = (writing: { shapeId: string; duration: number; lines: WritingLine[] }) => void
const observers = new Set<WritingObserver>()
export function observeWriting(observer: WritingObserver) {
	observers.add(observer)
	return () => { observers.delete(observer) }
}

let loading: Promise<void> | null = null

/** Register the handwriting font once, from the self-hosted font package. */
export function loadHandFont(): Promise<void> {
 if (typeof document === 'undefined') return Promise.resolve()
 loading ??= document.fonts.load('28px "Shantell Sans"').then(() => {})
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
 * Measure actual wrapped rows after layout, rather than treating a paragraph as one stroke.
 * Shapes that lay out their own lines (a table's rows) mark them with `data-write-line`.
 */
function textLines(shape: HTMLElement): WritingLine[] {
	const text = shape.querySelector('.loci-rich-text')
	const bounds = shape.getBoundingClientRect()
	if (!bounds.width || !bounds.height) return []
	const rects: DOMRect[] = Array.from(shape.querySelectorAll('[data-write-line]'), (el) => el.getBoundingClientRect())
	const walker = text && !rects.length ? document.createTreeWalker(text, NodeFilter.SHOW_TEXT) : null
	while (walker?.nextNode()) {
		const range = document.createRange()
		range.selectNodeContents(walker.currentNode)
		rects.push(...Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0))
	}
	const rows: WritingLine[] = []
	for (const rect of rects.sort((a, b) => a.top - b.top || a.left - b.left)) {
		const line = { x: (rect.left - bounds.left) / bounds.width, y: (rect.top - bounds.top) / bounds.height, w: rect.width / bounds.width, h: rect.height / bounds.height }
		const prev = rows.at(-1)
		if (prev && Math.abs(prev.y - line.y) < Math.min(prev.h, line.h) / 2) {
			const right = Math.max(prev.x + prev.w, line.x + line.w)
			prev.x = Math.min(prev.x, line.x)
			prev.w = right - prev.x
			prev.h = Math.max(prev.h, line.y + line.h - prev.y)
		} else rows.push(line)
	}
	// Split whitespace between rows evenly so ascenders and descenders remain visible.
	return rows.map((row, i) => {
		const top = i ? (rows[i - 1].y + rows[i - 1].h + row.y) / 2 : -0.2
		const bottom = i + 1 < rows.length ? (row.y + row.h + rows[i + 1].y) / 2 : 1.2
		return { ...row, clipTop: top, clipBottom: bottom }
	})
}

/**
 * Reveal a freshly created shape left to right over `ms` while the tutor's pen moves along it.
 * Works for any shape (native text included) by styling its DOM node by id.
 */
export async function writeIn(shapeId: string, area: { x: number; y: number; w: number; h: number }, ms: number) {
	if (typeof document === 'undefined') return
	const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
	if (reduce) return
	const style = document.createElement('style')
	const sel = `.loci-shape[data-shape-id="${CSS.escape(shapeId)}"]`
	style.textContent = `${sel} { clip-path: inset(0 100% 0 0); }`
	document.head.appendChild(style)
	let animation: Animation | undefined
 const syncPause=()=>{if(getSpeechTransport().paused)animation?.pause();else animation?.play()}
 const unsubscribe=subscribeSpeechTransport(syncPause)
	try {
		// Give React a frame to mount the newly created text. Keep it hidden during that frame.
		await new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, 100)
			requestAnimationFrame(() => { clearTimeout(timer); resolve() })
		})
		const shape = document.querySelector<HTMLElement>(sel)
		const lines = shape ? textLines(shape) : []
		for (const observer of observers) observer({ shapeId, duration: ms, lines })
		if (shape && lines.length > 1) {
			const total = lines.reduce((sum, line) => sum + line.w, 0)
			let offset = 0
			const frames: Keyframe[] = []
			for (const line of lines) {
				frames.push({ clipPath: lineClip(line, 0), offset })
				offset += line.w / total
				frames.push({ clipPath: lineClip(line, 1), offset: Math.min(1, offset) })
			}
			animation = shape.animate(frames, { duration: ms, easing: 'linear', fill: 'both' }); syncPause()
			for (const line of lines) {
				await penAlong({ x: area.x + line.x * area.w, y: area.y + line.y * area.h, w: line.w * area.w, h: line.h * area.h }, ms * line.w / total)
			}
		} else {
			style.textContent = `${sel} > * { animation: loci-write ${ms}ms linear both; }`
			await penAlong(area, ms)
		}
	} finally {
		unsubscribe()
  style.remove()
		animation?.cancel()
	}
}
