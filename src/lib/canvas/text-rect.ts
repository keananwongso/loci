'use client'
/**
 * Where a piece of text is drawn inside a shape on the board (a note, a label, a KaTeX equation),
 * measured from the rendered glyphs so a highlight lands exactly on it.
 */
import { findInRuns } from '@/lib/documents/text'
import { union, type Rect } from './placement'

/** The box around `query` in the shape's own coordinates, or null if it can't be found. */
export function textRectInShape(shapeId: string, query: string): Rect | null {
	if (typeof document === 'undefined') return null
	const el = document.querySelector<HTMLElement>(`.tl-shape[data-shape-id="${CSS.escape(shapeId)}"]`)
	if (!el) return null
	const roots = Array.from(el.querySelectorAll('.tl-rich-text, .katex-html'))
	const nodes: Text[] = []
	for (const root of roots.length ? roots : [el]) {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
		while (walker.nextNode()) nodes.push(walker.currentNode as Text)
	}
	const spans = findInRuns(
		nodes.map((n) => n.data),
		query
	)
	if (!spans) return null
	// Shapes out of view are culled (display: none) and have no layout; show it just to measure.
	const culled = el.style.display === 'none'
	if (culled) el.style.display = 'block'
	try {
		const box = el.getBoundingClientRect()
		// Rendered size over layout size: the camera's zoom, measured from the same layout.
		const scale = el.offsetWidth ? box.width / el.offsetWidth : 0
		if (!scale) return null
		const rects: Rect[] = []
		for (const s of spans) {
			const range = document.createRange()
			range.setStart(nodes[s.run], s.start)
			range.setEnd(nodes[s.run], s.end)
			for (const r of Array.from(range.getClientRects())) {
				if (r.width > 0 && r.height > 0) rects.push({ x: (r.left - box.left) / scale, y: (r.top - box.top) / scale, w: r.width / scale, h: r.height / scale })
			}
		}
		return rects.length ? union(rects) : null
	} finally {
		if (culled) el.style.display = 'none'
	}
}
