/**
 * Semantic placement: "put this to the right of that" -> exact canvas coordinates.
 * The model reasons in relationships; this module does the geometry and slides new
 * objects past anything already on the board instead of stacking them on top.
 */

export interface Rect {
	x: number
	y: number
	w: number
	h: number
}

export type Placement = 'right' | 'left' | 'above' | 'below' | 'center'
export type Align = 'start' | 'center' | 'end'

export const DEFAULT_GAP = 48
const CLEARANCE = 20

export function overlaps(a: Rect, b: Rect, margin = 0): boolean {
	return a.x < b.x + b.w + margin && a.x + a.w + margin > b.x && a.y < b.y + b.h + margin && a.y + a.h + margin > b.y
}

export function union(rects: Rect[]): Rect {
	const x0 = Math.min(...rects.map((r) => r.x))
	const y0 = Math.min(...rects.map((r) => r.y))
	const x1 = Math.max(...rects.map((r) => r.x + r.w))
	const y1 = Math.max(...rects.map((r) => r.y + r.h))
	return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function aligned(start: number, refSize: number, size: number, align: Align) {
	if (align === 'center') return start + refSize / 2 - size / 2
	if (align === 'end') return start + refSize - size
	return start
}

/** Initial position next to `ref`, before collision avoidance. */
export function besides(ref: Rect, size: { w: number; h: number }, placement: Placement, gap = DEFAULT_GAP, align: Align = 'start') {
	switch (placement) {
		case 'right':
			return { x: ref.x + ref.w + gap, y: aligned(ref.y, ref.h, size.h, align) }
		case 'left':
			return { x: ref.x - gap - size.w, y: aligned(ref.y, ref.h, size.h, align) }
		case 'below':
			return { x: aligned(ref.x, ref.w, size.w, align), y: ref.y + ref.h + gap }
		case 'above':
			return { x: aligned(ref.x, ref.w, size.w, align), y: ref.y - gap - size.h }
		case 'center':
			return { x: ref.x + ref.w / 2 - size.w / 2, y: ref.y + ref.h / 2 - size.h / 2 }
	}
}

/**
 * Place an object of `size` next to `ref`, then keep sliding it in the placement direction
 * past any obstacle it would overlap. Sliding (rather than jumping elsewhere) keeps the
 * object aligned with what it refers to: "right of a line on the page" ends up just right
 * of the page, at that line's height.
 */
export function placeRelative(
	ref: Rect,
	size: { w: number; h: number },
	placement: Placement,
	obstacles: Rect[],
	gap = DEFAULT_GAP,
	align: Align = 'start'
): { x: number; y: number } {
	let pos = besides(ref, size, placement, gap, align)
	if (placement === 'center') return pos
	for (let i = 0; i < 60; i++) {
		const rect = { ...pos, ...size }
		const hit = obstacles.find((o) => overlaps(rect, o, CLEARANCE / 2))
		if (!hit) return pos
		switch (placement) {
			case 'right':
				pos = { x: hit.x + hit.w + CLEARANCE, y: pos.y }
				break
			case 'left':
				pos = { x: hit.x - CLEARANCE - size.w, y: pos.y }
				break
			case 'below':
				pos = { x: pos.x, y: hit.y + hit.h + CLEARANCE }
				break
			case 'above':
				pos = { x: pos.x, y: hit.y - CLEARANCE - size.h }
				break
		}
	}
	return pos
}

/** Point on a rect's boundary/centre for a named side. */
export function sidePoint(r: Rect, side: 'center' | 'top' | 'bottom' | 'left' | 'right') {
	switch (side) {
		case 'top':
			return { x: r.x + r.w / 2, y: r.y }
		case 'bottom':
			return { x: r.x + r.w / 2, y: r.y + r.h }
		case 'left':
			return { x: r.x, y: r.y + r.h / 2 }
		case 'right':
			return { x: r.x + r.w, y: r.y + r.h / 2 }
		default:
			return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
	}
}

export const NORMALIZED_SIDE = {
	center: { x: 0.5, y: 0.5 },
	top: { x: 0.5, y: 0 },
	bottom: { x: 0.5, y: 1 },
	left: { x: 0, y: 0.5 },
	right: { x: 1, y: 0.5 },
} as const
