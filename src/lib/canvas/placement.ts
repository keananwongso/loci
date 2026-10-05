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

/** Shortest distance between two rects (0 when they touch or overlap). */
export function distance(a: Rect, b: Rect): number {
	const dx = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w))
	const dy = Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h))
	return Math.hypot(dx, dy)
}

/** How much further than `gap` a slide may carry an object before a closer free spot wins. */
const NEAR_SLACK = 160
/** Only this many of the obstacles nearest the reference shape the search (busy boards stay fast). */
const NEAR_OBSTACLES = 40

/**
 * Like `placeRelative`, but for a busy board: when older notes beside `ref` would push the new
 * object far away (sliding past a whole row of them), it takes the nearest free spot around `ref`
 * instead, preferring the asked-for side, then right, then below. The object stays next to what
 * it is about rather than drifting to wherever the row of notes ends.
 */
export function placeNear(
	ref: Rect,
	size: { w: number; h: number },
	placement: Placement,
	obstacles: Rect[],
	gap = DEFAULT_GAP,
	align: Align = 'start'
): { x: number; y: number } {
	const slid = placeRelative(ref, size, placement, obstacles, gap, align)
	if (placement === 'center') return slid
	// What the object really sits beside: the reference plus anything it is drawn on (a highlight's page).
	const body = union([ref, ...obstacles.filter((o) => overlaps(o, ref))])
	if (distance({ ...slid, ...size }, body) <= gap + NEAR_SLACK) return slid

	// The body itself keeps the full `gap`; only other things are hugged at clearance.
	const near = obstacles
		.filter((o) => !overlaps(o, ref))
		.map((o) => ({ o, d: distance(o, body) }))
		.sort((a, b) => a.d - b.d)
		.slice(0, NEAR_OBSTACLES)
		.map((x) => x.o)
	const want = besides(ref, size, placement, gap, align)
	const xs = new Set([want.x, body.x, body.x + body.w + gap, body.x - gap - size.w])
	const ys = new Set([want.y, body.y, body.y + body.h + gap, body.y - gap - size.h])
	for (const o of near) {
		xs.add(o.x + o.w + CLEARANCE)
		xs.add(o.x - CLEARANCE - size.w)
		ys.add(o.y + o.h + CLEARANCE)
		ys.add(o.y - CLEARANCE - size.h)
	}
	const sides: Record<Exclude<Placement, 'center'>, number> = { right: 120, below: 160, left: 480, above: 480 }
	sides[placement] = 0
	const score = (r: Rect) => {
		const side = Math.min(
			r.x >= body.x + body.w ? sides.right : Infinity,
			r.y >= body.y + body.h ? sides.below : Infinity,
			r.x + r.w <= body.x ? sides.left : Infinity,
			r.y + r.h <= body.y ? sides.above : Infinity
		)
		// Closest first, then on the preferred side, then lined up with where it was asked to go.
		return distance(r, body) + side + 0.1 * (Math.abs(r.x - want.x) + Math.abs(r.y - want.y))
	}
	const free = (r: Rect, among: Rect[]) => !overlaps(r, body, CLEARANCE / 2) && !among.some((o) => overlaps(r, o, CLEARANCE / 2))
	const candidates: { r: Rect; s: number }[] = []
	for (const x of xs) {
		for (const y of ys) {
			const r = { x, y, ...size }
			if (free(r, near)) candidates.push({ r, s: score(r) })
		}
	}
	candidates.sort((a, b) => a.s - b.s)
	const best = candidates.find((c) => free(c.r, obstacles))
	if (!best || distance(best.r, body) >= distance({ ...slid, ...size }, body)) return slid
	return { x: best.r.x, y: best.r.y }
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
