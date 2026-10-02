'use client'
/**
 * Executes validated canvas actions in the browser by creating native tldraw shapes.
 *
 * Model-facing ids map 1:1 to tldraw ids ("eq-1" <-> "shape:eq-1"), so the tutor can refer
 * to anything it drew in earlier turns. Every created shape carries meta.author = 'assistant'.
 */
import {
	createShapeId,
	toRichText,
	type Editor,
	type TLArrowBinding,
	type TLArrowShape,
	type TLGeoShape,
	type TLShape,
	type TLShapeId,
	type TLTextShape,
} from 'tldraw'
import type { ActionOf, Anchor, CanvasAction, GraphItem, Position } from '@/lib/actions/schema'
import { equalAspectHeight, toLocal } from '@/lib/math/graph'
import {
	EQUATION,
	GRAPH,
	HIGHLIGHT,
	MATERIAL,
	REGION,
	type EquationShape,
	type GraphShape,
	type HighlightShape,
	type LociMeta,
} from './shape-types'
import { DEFAULT_GAP, NORMALIZED_SIDE, placeRelative, sidePoint, union, type Rect } from './placement'
import { EQUATION_FONT_SIZE, measureLatex } from './katex'
import { TL_COLOR } from './palette'
import { markFresh } from './fresh'
import { fitZoom, frameArea, isFramed } from './camera'

export const toShapeId = (id: string) => (id.startsWith('shape:') ? (id as TLShapeId) : createShapeId(id))
export const toModelId = (id: string) => id.replace(/^shape:/, '')

/** Called with the area about to be drawn, so the UI can move the tutor's cursor there first. */
export type BeforeDraw = (area: Rect) => Promise<void>

const TEXT_PX = { s: 18, m: 24, l: 36 } as const

export class CanvasExecutor {
	private turnArea: Rect | null = null

	constructor(
		private editor: Editor,
		private turn: number,
		private beforeDraw: BeforeDraw = async () => {}
	) {}

	private meta(): LociMeta {
		return { author: 'assistant', turn: this.turn }
	}

	private bounds(id: string): Rect | undefined {
		const b = this.editor.getShapePageBounds(toShapeId(id))
		return b ? { x: b.x, y: b.y, w: b.w, h: b.h } : undefined
	}

	/** Bounds of everything a new object should avoid. Connectors and marks are ignored. */
	private obstacles(exclude: Set<TLShapeId> = new Set()): Rect[] {
		const ignored = new Set(['arrow', 'line', HIGHLIGHT, REGION, 'highlight'])
		return this.editor
			.getCurrentPageShapes()
			.filter((s) => !ignored.has(s.type) && !exclude.has(s.id) && this.editor.getShapeParent(s)?.type !== MATERIAL)
			.map((s) => this.editor.getShapePageBounds(s))
			.filter((b): b is NonNullable<typeof b> => Boolean(b))
			.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }))
	}

	private graphPoint(graphId: string, at: readonly [number, number]) {
		const g = this.editor.getShape<GraphShape>(toShapeId(graphId))
		if (!g || g.type !== GRAPH) throw new Error(`${graphId} is not a graph`)
		const local = toLocal(g.props, at)
		return { x: g.x + local.x, y: g.y + local.y, shape: g, local }
	}

	/** Resolve a semantic position to the top-left corner of an object of the given size. */
	private resolvePosition(pos: Position, size: { w: number; h: number }, exclude?: Set<TLShapeId>) {
		if ('relativeTo' in pos) {
			const ref = this.bounds(pos.relativeTo)
			if (!ref) throw new Error(`Unknown object ${pos.relativeTo}`)
			return placeRelative(ref, size, pos.placement, this.obstacles(exclude), pos.gap ?? DEFAULT_GAP, pos.align ?? 'start')
		}
		if ('graphId' in pos) {
			const p = this.graphPoint(pos.graphId, pos.at)
			return { x: p.x, y: p.y }
		}
		return { x: pos.x, y: pos.y }
	}

	/** Re-place a just-created shape using its real measured size (text wraps unpredictably). */
	private settle(id: TLShapeId, pos: Position | undefined) {
		if (!pos || !('relativeTo' in pos)) return
		const b = this.editor.getShapePageBounds(id)
		if (!b) return
		const next = this.resolvePosition(pos, { w: b.w, h: b.h }, new Set([id]))
		const shape = this.editor.getShape(id)!
		if (Math.abs(next.x - b.x) > 1 || Math.abs(next.y - b.y) > 1) {
			this.editor.updateShape({ id, type: shape.type, x: shape.x + (next.x - b.x), y: shape.y + (next.y - b.y) })
		}
	}

	/**
	 * Keep what the tutor is drawing in view, in the part of the screen the answer panel
	 * doesn't cover. Grows the frame to include everything drawn this turn while that stays
	 * legible; otherwise follows the newest object.
	 */
	private reveal(area: Rect) {
		const grown = this.turnArea ? union([this.turnArea, area]) : area
		this.turnArea = fitZoom(this.editor, grown) >= 0.5 ? grown : area
		if (!isFramed(this.editor, this.turnArea)) frameArea(this.editor, this.turnArea)
	}

	/** Start the frame from what the student pointed at (a region or highlight, not a whole page). */
	focusContext(ids: string[]) {
		const rects = ids.map((id) => this.bounds(id)).filter((r): r is Rect => Boolean(r))
		if (rects.length) this.turnArea = union(rects)
	}

	async execute(action: CanvasAction): Promise<void> {
		switch (action.type) {
			case 'say':
				return
			case 'write_text':
				return this.writeText(action)
			case 'write_equation':
				return this.writeEquation(action)
			case 'highlight':
				return this.highlight(action)
			case 'draw_arrow':
			case 'draw_line':
				return this.connector(action)
			case 'draw_rectangle':
			case 'draw_circle':
				return this.geo(action)
			case 'draw_axes':
				return this.axes(action)
			case 'add_to_graph':
				return this.addToGraph(action)
			case 'remove_from_graph': {
				const g = this.editor.getShape<GraphShape>(toShapeId(action.graphId))
				if (!g) return
				const remove = new Set(action.itemIds)
				this.editor.updateShape<GraphShape>({ id: g.id, type: GRAPH, props: { items: g.props.items.filter((i) => !remove.has(i.id)) } })
				return
			}
			case 'move_object': {
				const id = toShapeId(action.id)
				const shape = this.editor.getShape(id)
				const b = this.editor.getShapePageBounds(id)
				if (!shape || !b) return
				const pos = this.resolvePosition(action.position, { w: b.w, h: b.h }, new Set([id]))
				await this.beforeDraw({ ...pos, w: b.w, h: b.h })
				this.editor.animateShape(
					{ id, type: shape.type, x: shape.x + (pos.x - b.x), y: shape.y + (pos.y - b.y) },
					{ animation: { duration: 400 } }
				)
				return
			}
			case 'delete_objects':
				this.editor.deleteShapes(action.ids.map(toShapeId))
				return
			case 'focus': {
				const rects = action.ids.map((id) => this.bounds(id)).filter((r): r is Rect => Boolean(r))
				if (rects.length) frameArea(this.editor, union(rects))
				return
			}
		}
	}

	private async writeText(action: ActionOf<'write_text'>) {
		const size = action.size ?? 'm'
		const px = TEXT_PX[size]
		const maxW = action.maxWidth
		const longest = Math.max(...action.text.split('\n').map((l) => l.length))
		const estW = Math.min(maxW ?? 1e9, longest * px * 0.56 + 16)
		const estH = Math.ceil((longest * px * 0.56) / (maxW ?? 1e9) + action.text.split('\n').length) * px * 1.35
		const pos = this.resolvePosition(action.position, { w: estW, h: estH })
		await this.beforeDraw({ ...pos, w: estW, h: estH })
		const id = toShapeId(action.id!)
		this.editor.createShape<TLTextShape>({
			id,
			type: 'text',
			x: pos.x,
			y: pos.y,
			meta: this.meta(),
			props: {
				richText: toRichText(action.text),
				color: TL_COLOR[action.color ?? 'blue'],
				size,
				font: 'sans',
				textAlign: 'start',
				autoSize: !maxW,
				...(maxW ? { w: maxW } : {}),
			},
		})
		this.settle(id, action.position)
		this.done(id)
	}

	private async writeEquation(action: ActionOf<'write_equation'>) {
		const size = action.size ?? 'm'
		const m = measureLatex(action.latex, EQUATION_FONT_SIZE[size])
		const pos = this.resolvePosition(action.position, m)
		await this.beforeDraw({ ...pos, ...m })
		const id = toShapeId(action.id!)
		markFresh(id)
		this.editor.createShape<EquationShape>({
			id,
			type: EQUATION,
			x: pos.x,
			y: pos.y,
			meta: this.meta(),
			props: { latex: action.latex, color: action.color ?? 'ink', size, w: m.w, h: m.h, baseW: m.w, baseH: m.h },
		})
		this.done(id)
	}

	private async highlight(action: ActionOf<'highlight'>) {
		const targetId = toShapeId(action.target)
		const target = this.editor.getShape(targetId)
		if (!target) return
		const id = toShapeId(action.id!)
		const style = action.style ?? 'marker'
		const color = action.color ?? (style === 'marker' ? 'yellow' : 'pink')
		markFresh(id)

		if (target.type === MATERIAL) {
			const { w, h } = (target as Extract<TLShape, { type: typeof MATERIAL }>).props
			const r = action.region ?? { x: 0, y: 0, w: 1, h: 1 }
			const local = { x: r.x * w, y: r.y * h, w: Math.max(6, r.w * w), h: Math.max(6, r.h * h) }
			const page = this.editor.getShapePageTransform(targetId).applyToPoint({ x: local.x, y: local.y })
			await this.beforeDraw({ x: page.x, y: page.y, w: local.w, h: local.h })
			this.editor.createShape<HighlightShape>({
				id,
				type: HIGHLIGHT,
				parentId: targetId,
				x: local.x,
				y: local.y,
				meta: this.meta(),
				props: { w: local.w, h: local.h, style, color },
			})
		} else {
			const b = this.bounds(action.target)
			if (!b) return
			const r = action.region
			const area = r
				? { x: b.x + r.x * b.w, y: b.y + r.y * b.h, w: r.w * b.w, h: r.h * b.h }
				: { x: b.x - 8, y: b.y - 6, w: b.w + 16, h: b.h + 12 }
			await this.beforeDraw(area)
			this.editor.createShape<HighlightShape>({
				id,
				type: HIGHLIGHT,
				x: area.x,
				y: area.y,
				meta: this.meta(),
				props: { w: area.w, h: area.h, style, color },
			})
		}
		this.done(id)
	}

	private anchor(a: Anchor): { point: { x: number; y: number }; bind?: { toId: TLShapeId; normalizedAnchor: { x: number; y: number }; isPrecise: boolean; isExact: boolean } } {
		if ('objectId' in a) {
			const toId = toShapeId(a.objectId)
			const b = this.bounds(a.objectId)
			if (!b) throw new Error(`Unknown object ${a.objectId}`)
			const side = a.side ?? 'center'
			return {
				point: sidePoint(b, side),
				bind: { toId, normalizedAnchor: NORMALIZED_SIDE[side], isPrecise: side !== 'center', isExact: false },
			}
		}
		if ('graphId' in a) {
			const p = this.graphPoint(a.graphId, a.point)
			return {
				point: { x: p.x, y: p.y },
				bind: {
					toId: p.shape.id,
					normalizedAnchor: { x: p.local.x / p.shape.props.w, y: p.local.y / p.shape.props.h },
					isPrecise: true,
					isExact: true,
				},
			}
		}
		return { point: { x: a.x, y: a.y } }
	}

	private async connector(action: ActionOf<'draw_arrow'> | ActionOf<'draw_line'>) {
		const from = this.anchor(action.from)
		const to = this.anchor(action.to)
		const id = toShapeId(action.id!)
		await this.beforeDraw({
			x: Math.min(from.point.x, to.point.x),
			y: Math.min(from.point.y, to.point.y),
			w: Math.abs(to.point.x - from.point.x),
			h: Math.abs(to.point.y - from.point.y),
		})
		const isArrow = action.type === 'draw_arrow'
		this.editor.createShape<TLArrowShape>({
			id,
			type: 'arrow',
			x: from.point.x,
			y: from.point.y,
			meta: this.meta(),
			props: {
				start: { x: 0, y: 0 },
				end: { x: to.point.x - from.point.x, y: to.point.y - from.point.y },
				color: TL_COLOR[action.color ?? 'blue'],
				dash: action.dashed ? 'dashed' : 'solid',
				size: 's',
				font: 'sans',
				arrowheadStart: 'none',
				arrowheadEnd: isArrow ? 'arrow' : 'none',
				bend: isArrow ? (action.bend ?? 0) : 0,
				...(action.label ? { richText: toRichText(action.label) } : {}),
			},
		})
		const bindings = (
			[
				['start', from.bind],
				['end', to.bind],
			] as const
		)
			.filter(([, b]) => b)
			.map(([terminal, b]) => ({
				type: 'arrow' as const,
				fromId: id,
				toId: b!.toId,
				props: { terminal, normalizedAnchor: b!.normalizedAnchor, isPrecise: b!.isPrecise, isExact: b!.isExact, snap: 'none' as const },
			}))
		if (bindings.length) this.editor.createBindings<TLArrowBinding>(bindings)
		this.done(id)
	}

	private async geo(action: ActionOf<'draw_rectangle'> | ActionOf<'draw_circle'>) {
		const id = toShapeId(action.id!)
		const isEllipse = action.type === 'draw_circle'
		let rect: Rect
		if (action.around?.length) {
			const rects = action.around.map((a) => this.bounds(a)).filter((r): r is Rect => Boolean(r))
			const u = union(rects)
			const pad = isEllipse ? 26 : 14
			rect = { x: u.x - pad, y: u.y - pad, w: u.w + pad * 2, h: u.h + pad * 2 }
		} else {
			const size = { w: action.width ?? 160, h: action.height ?? 100 }
			rect = { ...this.resolvePosition(action.position!, size), ...size }
		}
		await this.beforeDraw(rect)
		const labelInside = action.label && !action.around?.length
		this.editor.createShape<TLGeoShape>({
			id,
			type: 'geo',
			x: rect.x,
			y: rect.y,
			meta: this.meta(),
			props: {
				geo: isEllipse ? 'ellipse' : 'rectangle',
				w: rect.w,
				h: rect.h,
				color: TL_COLOR[action.color ?? 'blue'],
				dash: action.dashed ? 'dashed' : 'draw',
				fill: 'none',
				size: 's',
				font: 'sans',
				...(labelInside ? { richText: toRichText(action.label!) } : {}),
			},
		})
		if (action.label && !labelInside) {
			this.editor.createShape<TLTextShape>({
				id: createShapeId(`${toModelId(id)}-label`),
				type: 'text',
				x: rect.x,
				y: rect.y - 34,
				meta: this.meta(),
				props: { richText: toRichText(action.label), color: TL_COLOR[action.color ?? 'blue'], size: 's', font: 'sans', autoSize: true },
			})
		}
		this.done(id)
	}

	private async axes(action: ActionOf<'draw_axes'>) {
		const w = action.width ?? 420
		const h = equalAspectHeight(w, action.xRange, action.yRange)
		const pos = this.resolvePosition(action.position, { w, h })
		await this.beforeDraw({ ...pos, w, h })
		const id = toShapeId(action.id!)
		const items = action.items ?? []
		for (const it of items) markFresh(`${id}:${it.id}`)
		this.editor.createShape<GraphShape>({
			id,
			type: GRAPH,
			x: pos.x,
			y: pos.y,
			meta: this.meta(),
			props: {
				w,
				h,
				xMin: action.xRange[0],
				xMax: action.xRange[1],
				yMin: action.yRange[0],
				yMax: action.yRange[1],
				grid: action.grid ?? true,
				xLabel: action.xLabel ?? 'x',
				yLabel: action.yLabel ?? 'y',
				title: action.title ?? '',
				items,
			},
		})
		this.done(id)
	}

	private async addToGraph(action: ActionOf<'add_to_graph'>) {
		const id = toShapeId(action.graphId)
		const g = this.editor.getShape<GraphShape>(id)
		if (!g) return
		const first = action.items[0]
		const focus = itemFocus(first)
		if (focus) {
			const p = this.graphPoint(action.graphId, focus)
			await this.beforeDraw({ x: p.x - 10, y: p.y - 10, w: 20, h: 20 })
		}
		for (const it of action.items) markFresh(`${id}:${it.id}`)
		const byId = new Map(g.props.items.map((it) => [it.id, it]))
		for (const it of action.items) byId.set(it.id, it)
		this.editor.updateShape<GraphShape>({ id, type: GRAPH, props: { items: [...byId.values()] } })
		this.done(id)
	}

	private done(id: TLShapeId) {
		const b = this.editor.getShapePageBounds(id)
		if (b) this.reveal({ x: b.x, y: b.y, w: b.w, h: b.h })
	}
}

/** A representative math point for an item, used to point the tutor's cursor at it. */
function itemFocus(it: GraphItem): readonly [number, number] | null {
	switch (it.kind) {
		case 'vector':
			return it.to
		case 'point':
		case 'label':
			return it.at
		case 'segment':
			return it.to
		case 'circle':
			return [it.center[0] + it.radius, it.center[1]]
		default:
			return null
	}
}
