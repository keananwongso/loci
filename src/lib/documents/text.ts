/**
 * Helpers for text extracted from pdf pages: grouping into lines for the model to read,
 * and locating an exact phrase so highlights land on the right glyphs.
 */
import type { Box, TextItem } from '@/lib/tutor/types'

export interface TextLine {
	text: string
	box: Box
}

/** Group pdf text items into reading-order lines. */
export function groupLines(items: TextItem[]): TextLine[] {
	const sorted = items
		.filter((it) => it.t.trim().length > 0)
		.map((it) => ({ it, cy: it.b[1] + it.b[3] / 2 }))
		.sort((a, b) => a.cy - b.cy || a.it.b[0] - b.it.b[0])

	const lines: Array<{ cy: number; h: number; parts: TextItem[] }> = []
	for (const { it, cy } of sorted) {
		const h = it.b[3]
		const line = lines.find((l) => Math.abs(l.cy - cy) < Math.min(l.h, h) * 0.55)
		if (line) {
			line.parts.push(it)
			line.h = Math.max(line.h, h)
		} else {
			lines.push({ cy, h, parts: [it] })
		}
	}

	return lines
		.sort((a, b) => a.cy - b.cy)
		.map((line) => {
			const parts = line.parts.sort((a, b) => a.b[0] - b.b[0])
			let text = ''
			let prevRight: number | null = null
			for (const p of parts) {
				const gap = prevRight === null ? 0 : p.b[0] - prevRight
				if (prevRight !== null && gap > line.h * 0.18 && !text.endsWith(' ') && !p.t.startsWith(' ')) text += ' '
				text += p.t
				prevRight = p.b[0] + p.b[2]
			}
			return { text: text.replace(/\s+/g, ' ').trim(), box: unionBoxes(parts.map(itemBox)) }
		})
}

export function itemBox(it: TextItem): Box {
	return { x: it.b[0], y: it.b[1], w: it.b[2], h: it.b[3] }
}

export function unionBoxes(boxes: Box[]): Box {
	const x0 = Math.min(...boxes.map((b) => b.x))
	const y0 = Math.min(...boxes.map((b) => b.y))
	const x1 = Math.max(...boxes.map((b) => b.x + b.w))
	const y1 = Math.max(...boxes.map((b) => b.y + b.h))
	return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

const EQUIVALENTS: Record<string, string> = {
	'⋅': '·',
	'∙': '·',
	'•': '·',
	'−': '-',
	'–': '-',
	'—': '-',
	'×': 'x',
	'’': "'",
	'‘': "'",
	'“': '"',
	'”': '"',
	'𝑢': 'u',
	'∣': '|',
	'‖': '||',
	'⟨': '<',
	'⟩': '>',
	'〈': '<',
	'〉': '>',
}

function normChar(c: string, loose: boolean): string {
	let s = c.normalize('NFKC').toLowerCase()
	s = EQUIVALENTS[s] ?? s
	if (/\s/.test(s)) return ''
	if (loose && /[_^{}\\$*·.,:;()[\]]/.test(s)) return ''
	return s
}

/**
 * Find `query` in the page's text and return its normalised bounding box.
 * Whitespace is ignored, so "∇f · u" matches glyphs extracted as "∇f·u".
 * A second, looser pass also ignores LaTeX punctuation (_ ^ { } \) and dots,
 * so "D_u f" can match "Duf". When several matches exist, the one closest to `near` wins.
 */
export function findTextBox(items: TextItem[], query: string, near?: Box): Box | null {
	for (const loose of [false, true]) {
		const stream: Array<{ c: string; item: number; idx: number; len: number }> = []
		const order = items
			.map((it, i) => ({ it, i, cy: it.b[1] + it.b[3] / 2 }))
			.sort((a, b) => {
				const sameLine = Math.abs(a.cy - b.cy) < Math.min(a.it.b[3], b.it.b[3]) * 0.55
				return sameLine ? a.it.b[0] - b.it.b[0] : a.cy - b.cy
			})
		for (const { it, i } of order) {
			const chars = Array.from(it.t)
			chars.forEach((ch, idx) => {
				const n = normChar(ch, loose)
				for (const c of Array.from(n)) stream.push({ c, item: i, idx, len: chars.length })
			})
		}
		const needle = Array.from(query)
			.map((c) => normChar(c, loose))
			.join('')
		if (!needle) continue
		const hay = stream.map((s) => s.c).join('')

		const boxes: Box[] = []
		let from = 0
		for (;;) {
			const at = hay.indexOf(needle, from)
			if (at < 0) break
			boxes.push(boxForRange(items, stream.slice(at, at + Array.from(needle).length)))
			from = at + 1
			if (boxes.length > 50) break
		}
		if (boxes.length === 0) continue
		if (!near || boxes.length === 1) return pad(boxes[0])
		const cx = near.x + near.w / 2
		const cy = near.y + near.h / 2
		boxes.sort((a, b) => dist(a, cx, cy) - dist(b, cx, cy))
		return pad(boxes[0])
	}
	return null
}

function dist(b: Box, cx: number, cy: number) {
	return Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy)
}

function boxForRange(items: TextItem[], chars: Array<{ item: number; idx: number; len: number }>): Box {
	const byItem = new Map<number, { min: number; max: number; len: number }>()
	for (const c of chars) {
		const cur = byItem.get(c.item)
		if (cur) {
			cur.min = Math.min(cur.min, c.idx)
			cur.max = Math.max(cur.max, c.idx)
		} else byItem.set(c.item, { min: c.idx, max: c.idx, len: c.len })
	}
	const boxes: Box[] = []
	for (const [i, r] of byItem) {
		const [x, y, w, h] = items[i].b
		const cw = w / Math.max(r.len, 1)
		boxes.push({ x: x + cw * r.min, y, w: cw * (r.max - r.min + 1), h })
	}
	return unionBoxes(boxes)
}

function pad(b: Box): Box {
	const px = 0.006
	const py = b.h * 0.2
	const x = Math.max(0, b.x - px)
	const y = Math.max(0, b.y - py)
	return { x, y, w: Math.min(1 - x, b.w + px * 2), h: Math.min(1 - y, b.h + py * 2) }
}

/** Text items whose centre lies inside a normalised region. */
export function textInRegion(items: TextItem[], region: Box): string {
	const inside = items.filter((it) => {
		const cx = it.b[0] + it.b[2] / 2
		const cy = it.b[1] + it.b[3] / 2
		return cx >= region.x && cx <= region.x + region.w && cy >= region.y && cy <= region.y + region.h
	})
	return groupLines(inside)
		.map((l) => l.text)
		.join('\n')
}
