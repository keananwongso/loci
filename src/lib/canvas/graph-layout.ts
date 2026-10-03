/**
 * Pure layout for graph shapes: turns graph props (math-space items) into pixel-space
 * strokes and labels. Used by the on-canvas component and by svg export.
 */
import type { GraphItem } from '@/lib/actions/schema'
import { compileExpression, sampleFunction } from '@/lib/math/expr'
import { formatTick, niceStep, projectOntoLine, ticks, toLocal, type GraphFrame } from '@/lib/math/graph'
import { inkHex } from './palette'

export interface Stroke {
	key: string
	d: string
	color: string
	width: number
	dashed?: boolean
	fill?: string
	opacity?: number
	/** Arrowheads and dots fade in after their line draws. */
	late?: boolean
	itemId?: string
}

export interface GraphLabel {
	key: string
	x: number
	y: number
	latex: string
	color: string
	itemId?: string
	size?: number
	/** The point this label names. Labels can move around it to stay off the lines. */
	anchor?: [number, number]
}

export interface GraphLayout {
	grid: string
	axes: Stroke[]
	tickLabels: Array<{ x: number; y: number; text: string; anchor: 'middle' | 'end' }>
	strokes: Stroke[]
	labels: GraphLabel[]
}

type V = [number, number]
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]]
const len = (a: V) => Math.hypot(a[0], a[1])
const norm = (a: V): V => {
	const l = len(a) || 1
	return [a[0] / l, a[1] / l]
}
const f1 = (n: number) => n.toFixed(1)

function arrowHead(tip: V, dir: V, size = 11): string {
	const [dx, dy] = norm(dir)
	const nx = -dy
	const ny = dx
	const bx = tip[0] - dx * size
	const by = tip[1] - dy * size
	const hw = size * 0.46
	return `M${f1(tip[0])},${f1(tip[1])} L${f1(bx + nx * hw)},${f1(by + ny * hw)} L${f1(bx - nx * hw)},${f1(by - ny * hw)} Z`
}

export interface GraphProps extends GraphFrame {
	grid: boolean
	xLabel: string
	yLabel: string
	items: GraphItem[]
}

export function layoutGraph(p: GraphProps): GraphLayout {
	const frame: GraphFrame = p
	const px = (m: V): V => {
		const l = toLocal(frame, m)
		return [l.x, l.y]
	}
	const ppu = p.w / (p.xMax - p.xMin)

	// --- grid + axes
	const step = niceStep(p.xMax - p.xMin, p.w)
	const xs = ticks(p.xMin, p.xMax, step)
	const ys = ticks(p.yMin, p.yMax, step)
	let grid = ''
	if (p.grid) {
		for (const x of xs) grid += `M${f1(px([x, 0])[0])},0 V${f1(p.h)} `
		for (const y of ys) grid += `M0,${f1(px([0, y])[1])} H${f1(p.w)} `
	}
	const axisY = p.yMin <= 0 && p.yMax >= 0 ? px([0, 0])[1] : p.h
	const axisX = p.xMin <= 0 && p.xMax >= 0 ? px([0, 0])[0] : 0
	const axisColor = '#3a4150'
	const axes: Stroke[] = [
		{ key: 'ax', d: `M0,${f1(axisY)} H${f1(p.w)}`, color: axisColor, width: 1.4 },
		{ key: 'ay', d: `M${f1(axisX)},${f1(p.h)} V0`, color: axisColor, width: 1.4 },
		{ key: 'axh', d: arrowHead([p.w + 2, axisY], [1, 0], 9), color: axisColor, width: 0, fill: axisColor },
		{ key: 'ayh', d: arrowHead([axisX, -2], [0, -1], 9), color: axisColor, width: 0, fill: axisColor },
	]
	const tickLabels: GraphLayout['tickLabels'] = []
	for (const x of xs) {
		if (x === 0) continue
		const [tx] = px([x, 0])
		if (tx < 8 || tx > p.w - 8) continue
		tickLabels.push({ x: tx, y: axisY + 14, text: formatTick(x), anchor: 'middle' })
	}
	for (const y of ys) {
		if (y === 0) continue
		const [, ty] = px([0, y])
		if (ty < 8 || ty > p.h - 8) continue
		tickLabels.push({ x: axisX - 6, y: ty + 4, text: formatTick(y), anchor: 'end' })
	}

	const strokes: Stroke[] = []
	const labels: GraphLabel[] = []
	// Points along everything drawn, so labels can be placed where they cover nothing.
	const ink: V[] = []
	const line = (a: V, b: V) => {
		const n = Math.max(1, Math.ceil(len(sub(b, a)) / 5))
		for (let i = 0; i <= n; i++) ink.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n])
	}
	line([0, axisY], [p.w, axisY])
	line([axisX, 0], [axisX, p.h])
	if (p.xLabel) labels.push({ key: 'xl', x: p.w + 16, y: axisY + 2, latex: p.xLabel, color: axisColor, size: 15 })
	if (p.yLabel) labels.push({ key: 'yl', x: axisX, y: -18, latex: p.yLabel, color: axisColor, size: 15 })

	const byId = new Map(p.items.map((it) => [it.id, it]))
	const tailOf = (v: Extract<GraphItem, { kind: 'vector' }>): V => (v.from ?? [0, 0]) as V

	// Draw order: areas/curves first, then guides, then vectors and points on top.
	const order: GraphItem['kind'][] = ['circle', 'function', 'segment', 'projection', 'angle', 'vector', 'point', 'label']
	const items = [...p.items].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))

	for (const it of items) {
		const color = inkHex(it.color, it.kind === 'circle' ? 'grey' : 'blue')
		const k = it.id
		switch (it.kind) {
			case 'vector': {
				const a = px(tailOf(it))
				const b = px(it.to as V)
				const dir = sub(b, a)
				if (len(dir) < 1) break
				const u = norm(dir)
				const end: V = [b[0] - u[0] * 8, b[1] - u[1] * 8]
				strokes.push({ key: `${k}`, d: `M${f1(a[0])},${f1(a[1])} L${f1(end[0])},${f1(end[1])}`, color, width: 2.6, itemId: k })
				strokes.push({ key: `${k}-h`, d: arrowHead(b, dir, 13), color, width: 0, fill: color, late: true, itemId: k })
				line(a, b)
				if (it.label) {
					const n: V = [-u[1], u[0]]
					labels.push({ key: k, x: b[0] + u[0] * 12 + n[0] * 12, y: b[1] + u[1] * 12 + n[1] * 12, latex: it.label, color, itemId: k, anchor: b })
				}
				break
			}
			case 'point': {
				const [x, y] = px(it.at as V)
				strokes.push({ key: k, d: `M${f1(x - 4.5)},${f1(y)} a4.5,4.5 0 1,0 9,0 a4.5,4.5 0 1,0 -9,0`, color, width: 0, fill: color, late: true, itemId: k })
				line([x - 5, y], [x + 5, y])
				if (it.label) labels.push({ key: k, x: x + 12, y: y - 12, latex: it.label, color, itemId: k, anchor: [x, y] })
				break
			}
			case 'segment': {
				const a = px(it.from as V)
				const b = px(it.to as V)
				strokes.push({ key: k, d: `M${f1(a[0])},${f1(a[1])} L${f1(b[0])},${f1(b[1])}`, color, width: 2, dashed: it.dashed, itemId: k })
				line(a, b)
				if (it.label) {
					const u = norm(sub(b, a))
					const mid: V = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
					labels.push({ key: k, x: mid[0] - u[1] * 14, y: mid[1] + u[0] * 14, latex: it.label, color, itemId: k, anchor: mid })
				}
				break
			}
			case 'function': {
				let f: (x: number) => number
				try {
					f = compileExpression(it.expr)
				} catch {
					break
				}
				const [d0, d1] = (it.domain as V | undefined) ?? [p.xMin, p.xMax]
				const runs = sampleFunction(f, Math.max(d0, p.xMin), Math.min(d1, p.xMax), [p.yMin, p.yMax])
				const d = runs.map((run) => run.map((pt, i) => `${i ? 'L' : 'M'}${px(pt).map(f1).join(',')}`).join(' ')).join(' ')
				if (d) strokes.push({ key: k, d, color, width: 2.4, dashed: it.dashed, itemId: k })
				for (const run of runs) for (let i = 1; i < run.length; i++) line(px(run[i - 1] as V), px(run[i] as V))
				// Label the last point of the curve that is actually inside the frame.
				const visible = runs.flat().filter(([, y]) => y >= p.yMin && y <= p.yMax)
				const last = visible.at(-1)
				if (it.label && last) {
					const [x, y] = px(last)
					labels.push({ key: k, x: Math.min(x + 6, p.w - 24), y: Math.max(14, Math.min(p.h - 14, y - 14)), latex: it.label, color, itemId: k, anchor: [x, y] })
				}
				break
			}
			case 'circle': {
				const [cx, cy] = px(it.center as V)
				const r = it.radius * ppu
				strokes.push({
					key: k,
					d: `M${f1(cx + r)},${f1(cy)} A${f1(r)},${f1(r)} 0 1,1 ${f1(cx - r)},${f1(cy)} A${f1(r)},${f1(r)} 0 1,1 ${f1(cx + r)},${f1(cy)}`,
					color,
					width: 1.6,
					dashed: it.dashed,
					itemId: k,
				})
				for (let i = 0; i < 48; i++) {
					const t0 = (i / 48) * Math.PI * 2
					const t1 = ((i + 1) / 48) * Math.PI * 2
					line([cx + Math.cos(t0) * r, cy + Math.sin(t0) * r], [cx + Math.cos(t1) * r, cy + Math.sin(t1) * r])
				}
				if (it.label) {
					const a = -Math.PI * 0.75
					const on: V = [cx + Math.cos(a) * r, cy + Math.sin(a) * r]
					labels.push({ key: k, x: cx + Math.cos(a) * (r + 18), y: cy + Math.sin(a) * (r + 14), latex: it.label, color, itemId: k, anchor: on })
				}
				break
			}
			case 'angle': {
				const va = byId.get(it.between[0])
				const vb = byId.get(it.between[1])
				if (va?.kind !== 'vector' || vb?.kind !== 'vector') break
				const o = px(tailOf(va))
				const da = sub(px(va.to as V), o)
				const db = sub(px(vb.to as V), o)
				const r = Math.max(18, Math.min(34, len(da) * 0.4, len(db) * 0.4))
				const a0 = Math.atan2(da[1], da[0])
				let delta = Math.atan2(db[1], db[0]) - a0
				while (delta > Math.PI) delta -= Math.PI * 2
				while (delta < -Math.PI) delta += Math.PI * 2
				const a1 = a0 + delta
				const p0: V = [o[0] + Math.cos(a0) * r, o[1] + Math.sin(a0) * r]
				const p1: V = [o[0] + Math.cos(a1) * r, o[1] + Math.sin(a1) * r]
				const sweep = delta > 0 ? 1 : 0
				strokes.push({
					key: k,
					d: `M${f1(p0[0])},${f1(p0[1])} A${f1(r)},${f1(r)} 0 0,${sweep} ${f1(p1[0])},${f1(p1[1])}`,
					color: inkHex(it.color, 'violet'),
					width: 2,
					itemId: k,
				})
				if (it.label) {
					const mid = a0 + delta / 2
					labels.push({
						key: k,
						x: o[0] + Math.cos(mid) * (r + 13),
						y: o[1] + Math.sin(mid) * (r + 13),
						latex: it.label,
						color: inkHex(it.color, 'violet'),
						itemId: k,
						anchor: [o[0] + Math.cos(mid) * r, o[1] + Math.sin(mid) * r],
					})
				}
				break
			}
			case 'projection': {
				const of = byId.get(it.of)
				const onto = byId.get(it.onto)
				if (of?.kind !== 'vector' || onto?.kind !== 'vector') break
				const o = tailOf(onto)
				const dir = sub(onto.to as V, o)
				const tip = of.to as V
				const foot = projectOntoLine(tip, o, dir)
				const [fx, fy] = px(foot)
				const [tx, ty] = px(tip)
				const [ox, oy] = px(o)
				strokes.push({ key: `${k}-drop`, d: `M${f1(tx)},${f1(ty)} L${f1(fx)},${f1(fy)}`, color: '#7b8494', width: 1.5, dashed: true, itemId: k })
				strokes.push({ key: `${k}`, d: `M${f1(ox)},${f1(oy)} L${f1(fx)},${f1(fy)}`, color, width: 6, opacity: 0.45, itemId: k })
				line([tx, ty], [fx, fy])
				line([ox, oy], [fx, fy])
				// right-angle marker at the foot
				const u = norm(sub([fx, fy], [ox, oy]))
				const w = norm(sub([tx, ty], [fx, fy]))
				if (len(sub([tx, ty], [fx, fy])) > 10 && len(sub([fx, fy], [ox, oy])) > 10) {
					const s = 8
					const a: V = [fx - u[0] * s, fy - u[1] * s]
					const c: V = [fx + w[0] * s, fy + w[1] * s]
					const b: V = [a[0] + w[0] * s, a[1] + w[1] * s]
					strokes.push({ key: `${k}-sq`, d: `M${f1(a[0])},${f1(a[1])} L${f1(b[0])},${f1(b[1])} L${f1(c[0])},${f1(c[1])}`, color: '#7b8494', width: 1.2, late: true, itemId: k })
				}
				if (it.label) {
					const n: V = [u[1], -u[0]]
					const side = (tx - fx) * n[0] + (ty - fy) * n[1] > 0 ? -1 : 1
					const mid: V = [(ox + fx) / 2, (oy + fy) / 2]
					labels.push({ key: k, x: mid[0] + n[0] * 18 * side, y: mid[1] + n[1] * 18 * side, latex: it.label, color, itemId: k, anchor: mid })
				}
				break
			}
			case 'label': {
				const [x, y] = px(it.at as V)
				labels.push({ key: k, x, y, latex: it.text, color: inkHex(it.color, 'ink'), itemId: k, anchor: [x, y] })
				break
			}
		}
	}

	placeLabels(labels, ink, p.w, p.h)
	separateLabels(labels)
	return { grid, axes, tickLabels, strokes, labels }
}

/**
 * Move each label to the spot around its anchor that covers the least ink and no earlier label,
 * preferring where it was put. Free text labels may only shift a little.
 */
export function placeLabels(labels: GraphLabel[], ink: Array<[number, number]>, w: number, h: number) {
	const placed: Array<{ x: number; y: number; w: number; h: number }> = []
	const covers = (x: number, y: number, s: { w: number; h: number }) => {
		let n = 0
		for (const [px, py] of ink) if (Math.abs(px - x) < s.w / 2 + 2 && Math.abs(py - y) < s.h / 2 + 2) n++
		return n
	}
	const clash = (x: number, y: number, s: { w: number; h: number }) =>
		placed.some((o) => Math.abs(o.x - x) < (o.w + s.w) / 2 + 2 && Math.abs(o.y - y) < (o.h + s.h) / 2 + 2)
	for (const l of labels) {
		const s = labelSize(l.latex, l.size)
		if (l.anchor) {
			const [ax, ay] = l.anchor
			const free = l.x === ax && l.y === ay
			const r = free ? Math.max(10, s.h * 0.6) : Math.max(Math.hypot(l.x - ax, l.y - ay), Math.hypot(s.w / 2, s.h / 2) + 4)
			const candidates: Array<[number, number, number]> = [[l.x, l.y, 0]]
			for (let i = 0; i < 16; i++) {
				const a = (i / 16) * Math.PI * 2
				candidates.push([ax + Math.cos(a) * (r + s.w * 0.25 * Math.abs(Math.cos(a))), ay + Math.sin(a) * r, 1 + Math.abs(i - 8) * 0.01])
			}
			let best = candidates[0]
			let bestScore = Infinity
			for (const c of candidates) {
				const out = c[0] - s.w / 2 < -6 || c[0] + s.w / 2 > w + 6 || c[1] - s.h / 2 < -6 || c[1] + s.h / 2 > h + 6
				const score = covers(c[0], c[1], s) + (clash(c[0], c[1], s) ? 40 : 0) + (out ? 25 : 0) + c[2]
				if (score < bestScore) {
					best = c
					bestScore = score
				}
			}
			l.x = best[0]
			l.y = best[1]
		}
		placed.push({ x: l.x, y: l.y, ...s })
	}
}

/** Rough on-screen size of a KaTeX label, from its LaTeX source. */
function labelSize(latex: string, size = 17) {
	const visible = latex
		.replace(/\\(text|mathrm|mathbf)\{([^}]*)\}/g, '$2')
		.replace(/\\[a-zA-Z]+/g, 'x')
		.replace(/[{}_^\\]/g, '')
	// The handwriting font runs a little wider than KaTeX's.
	return { w: Math.max(1, visible.length) * size * 0.62 + 10, h: size * 1.35 }
}

/** Nudge overlapping labels apart (later labels move), so names stay readable. */
export function separateLabels(labels: GraphLabel[]) {
	for (let pass = 0; pass < 6; pass++) {
		let moved = false
		for (let i = 0; i < labels.length; i++) {
			for (let j = 0; j < i; j++) {
				const a = labels[j]
				const b = labels[i]
				const sa = labelSize(a.latex, a.size)
				const sb = labelSize(b.latex, b.size)
				const overlapX = (sa.w + sb.w) / 2 - Math.abs(a.x - b.x)
				const overlapY = (sa.h + sb.h) / 2 - Math.abs(a.y - b.y)
				if (overlapX > 0 && overlapY > 0) {
					// Move along the axis that needs the smaller push.
					if (overlapY < overlapX) b.y += (b.y >= a.y ? 1 : -1) * (overlapY + 2)
					else b.x += (b.x >= a.x ? 1 : -1) * (overlapX + 2)
					moved = true
				}
			}
		}
		if (!moved) break
	}
}
