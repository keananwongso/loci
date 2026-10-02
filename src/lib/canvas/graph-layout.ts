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
				if (it.label) {
					const n: V = [-u[1], u[0]]
					labels.push({ key: k, x: b[0] + u[0] * 12 + n[0] * 12, y: b[1] + u[1] * 12 + n[1] * 12, latex: it.label, color, itemId: k })
				}
				break
			}
			case 'point': {
				const [x, y] = px(it.at as V)
				strokes.push({ key: k, d: `M${f1(x - 4.5)},${f1(y)} a4.5,4.5 0 1,0 9,0 a4.5,4.5 0 1,0 -9,0`, color, width: 0, fill: color, late: true, itemId: k })
				if (it.label) labels.push({ key: k, x: x + 12, y: y - 12, latex: it.label, color, itemId: k })
				break
			}
			case 'segment': {
				const a = px(it.from as V)
				const b = px(it.to as V)
				strokes.push({ key: k, d: `M${f1(a[0])},${f1(a[1])} L${f1(b[0])},${f1(b[1])}`, color, width: 2, dashed: it.dashed, itemId: k })
				if (it.label) {
					const u = norm(sub(b, a))
					labels.push({ key: k, x: (a[0] + b[0]) / 2 - u[1] * 14, y: (a[1] + b[1]) / 2 + u[0] * 14, latex: it.label, color, itemId: k })
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
				const last = runs.at(-1)?.at(-1)
				if (it.label && last) {
					const [x, y] = px(last)
					labels.push({ key: k, x: Math.min(x, p.w - 10) + 4, y: Math.max(12, Math.min(p.h - 12, y - 14)), latex: it.label, color, itemId: k })
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
				if (it.label) {
					const a = -Math.PI * 0.75
					labels.push({ key: k, x: cx + Math.cos(a) * (r + 18), y: cy + Math.sin(a) * (r + 14), latex: it.label, color, itemId: k })
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
					labels.push({ key: k, x: o[0] + Math.cos(mid) * (r + 13), y: o[1] + Math.sin(mid) * (r + 13), latex: it.label, color: inkHex(it.color, 'violet'), itemId: k })
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
					labels.push({ key: k, x: (ox + fx) / 2 + n[0] * 18 * side, y: (oy + fy) / 2 + n[1] * 18 * side, latex: it.label, color, itemId: k })
				}
				break
			}
			case 'label': {
				const [x, y] = px(it.at as V)
				labels.push({ key: k, x, y, latex: it.text, color: inkHex(it.color, 'ink'), itemId: k })
				break
			}
		}
	}

	return { grid, axes, tickLabels, strokes, labels }
}
