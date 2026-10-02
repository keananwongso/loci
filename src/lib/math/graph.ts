/**
 * Coordinate mapping for graph objects. Graphs store their contents in math coordinates;
 * the renderer and the action executor both use these helpers to map to canvas space.
 */

export interface GraphFrame {
	w: number
	h: number
	xMin: number
	xMax: number
	yMin: number
	yMax: number
}

/** Math coordinate -> local pixel coordinate inside the graph shape. */
export function toLocal(frame: GraphFrame, [mx, my]: readonly [number, number]): { x: number; y: number } {
	return {
		x: ((mx - frame.xMin) / (frame.xMax - frame.xMin)) * frame.w,
		y: ((frame.yMax - my) / (frame.yMax - frame.yMin)) * frame.h,
	}
}

/** Height that keeps x and y on the same scale (so angles and lengths look right). */
export function equalAspectHeight(width: number, xRange: [number, number], yRange: [number, number]): number {
	const ppu = width / (xRange[1] - xRange[0])
	return (yRange[1] - yRange[0]) * ppu
}

/** A "nice" tick step for a range spanning roughly `pixels` on screen. */
export function niceStep(span: number, pixels: number, minPixelsPerTick = 36): number {
	const raw = (span * minPixelsPerTick) / Math.max(pixels, 1)
	const pow = Math.pow(10, Math.floor(Math.log10(raw)))
	for (const m of [1, 2, 5, 10]) {
		if (m * pow >= raw) return m * pow
	}
	return 10 * pow
}

export function ticks(min: number, max: number, step: number): number[] {
	const out: number[] = []
	const start = Math.ceil(min / step) * step
	for (let v = start; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : +v.toFixed(10))
	return out
}

export function formatTick(v: number): string {
	if (Number.isInteger(v)) return String(v)
	return String(+v.toFixed(3))
}

/** Foot of the perpendicular from point p onto the line through o in direction d. */
export function projectOntoLine(
	p: readonly [number, number],
	o: readonly [number, number],
	d: readonly [number, number]
): [number, number] {
	const dd = d[0] * d[0] + d[1] * d[1]
	if (dd === 0) return [o[0], o[1]]
	const t = ((p[0] - o[0]) * d[0] + (p[1] - o[1]) * d[1]) / dd
	return [o[0] + d[0] * t, o[1] + d[1] * t]
}
