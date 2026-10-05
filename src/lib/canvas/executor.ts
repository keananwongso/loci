'use client'
/**
 * Executes validated canvas actions in the browser by creating native tldraw shapes.
 *
 * Model-facing ids map 1:1 to tldraw ids ("eq-1" <-> "shape:eq-1"), so the tutor can refer
 * to anything it drew in earlier turns. Every created shape carries meta.author = 'assistant'.
 */
import {
	Group2d,
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
	TABLE,
	type EquationShape,
	type GraphShape,
	type HighlightShape,
	type LociMeta,
	type TableShape,
} from './shape-types'
import { cellRect, columnWidths, tableSize, toCells } from './table'
import { DEFAULT_GAP, NORMALIZED_SIDE, blocks, clearSpot, distance, overlaps, placeNear, sidePoint, union, type Obstacle, type Rect } from './placement'
import { EQUATION_FONT_SIZE, latexToPlain, measureLatex } from './katex'
import { handFontReady, writeIn, writingTime } from './hand'
import { TL_COLOR } from './palette'
import { markFresh } from './fresh'
import { textRectInShape } from './text-rect'
import { MIN_READABLE_ZOOM, fitZoom, frameArea, isFramed } from './camera'

export const toShapeId = (id: string) => (id.startsWith('shape:') ? (id as TLShapeId) : createShapeId(id))
export const toModelId = (id: string) => id.replace(/^shape:/, '')

/** Called with the area about to be drawn, so the UI can move the tutor's cursor there first. */
export type BeforeDraw = (area: Rect) => Promise<void>

const TEXT_PX = { s: 18, m: 24, l: 36 } as const
/** The slowest a line is written out, however long its sentence is. */
const MAX_PACED_WRITE = 4500
/** Space between lines of working. */
const LINE_GAP = 14

/** An absolute position further than this from the material in focus is re-anchored beside it. */
const FAR_FROM_FOCUS = 900

export class CanvasExecutor {
	private turnArea: Rect | null = null
	/**
	 * The material (or part of it) this turn is about: what the student pointed at, else the first
	 * thing the tutor highlights or builds beside. Stray work is pulled back next to it.
	 */
	private focusArea: Rect | null = null

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

	/**
	 * Bounds of everything a new object should avoid. Connectors and marks are ignored. Unfilled
	 * boxes and rings are frames: text may go inside one, just not across its border.
	 */
	private obstacles(exclude: Set<TLShapeId> = new Set()): Obstacle[] {
		const ignored = new Set(['arrow', 'line', HIGHLIGHT, REGION, 'highlight'])
		return this.editor
			.getCurrentPageShapes()
			.filter((s) => !ignored.has(s.type) && !exclude.has(s.id) && this.editor.getShapeParent(s)?.type !== MATERIAL)
			.flatMap((s) => {
				const b = this.editor.getShapePageBounds(s)
				if (!b) return []
				const frame = s.type === 'geo' && (s as TLGeoShape).props.fill === 'none'
				return [{ x: b.x, y: b.y, w: b.w, h: b.h, ...(frame ? { frame } : {}) }]
			})
	}

	/** Slide a just-created shape off anything it sits on, using its real measured size. */
	private clear(id: TLShapeId) {
		const b = this.editor.getShapePageBounds(id)
		const shape = this.editor.getShape(id)
		if (!b || !shape) return
		const next = clearSpot({ x: b.x, y: b.y, w: b.w, h: b.h }, this.obstacles(new Set([id])))
		if (Math.abs(next.x - b.x) > 1 || Math.abs(next.y - b.y) > 1) {
			this.editor.updateShape({ id, type: shape.type, x: shape.x + (next.x - b.x), y: shape.y + (next.y - b.y) })
		}
	}

	private graphPoint(graphId: string, at: readonly [number, number]) {
		const g = this.editor.getShape<GraphShape>(toShapeId(graphId))
		if (!g || g.type !== GRAPH) throw new Error(`${graphId} is not a graph`)
		const local = toLocal(g.props, at)
		return { x: g.x + local.x, y: g.y + local.y, shape: g, local }
	}

	/**
	 * Resolve a semantic position to the top-left corner of an object of the given size. `relX`
	 * is where a new equation's relation sign sits from its left edge, to line it up with the
	 * previous line of working.
	 */
	private resolvePosition(pos: Position, size: { w: number; h: number; relX?: number }, exclude?: Set<TLShapeId>) {
		if ('nextLineOf' in pos) return this.nextLine(pos.nextLineOf, size, exclude)
		if ('relativeTo' in pos) {
			const ref = this.bounds(pos.relativeTo)
			if (!ref) throw new Error(`Unknown object ${pos.relativeTo}`)
			if (this.editor.getShape(toShapeId(pos.relativeTo))?.type === MATERIAL) this.focusArea ??= ref
			return placeNear(ref, size, pos.placement, this.obstacles(exclude), pos.gap ?? DEFAULT_GAP, pos.align ?? 'start')
		}
		if ('graphId' in pos) {
			const p = this.graphPoint(pos.graphId, pos.at)
			return { x: p.x, y: p.y }
		}
		return this.absolute(pos, size, exclude)
	}

	/**
	 * Raw coordinates are kept when they land in free space near what the turn is about. On top of
	 * something, or far across the board from the material in focus, the object goes in the nearest
	 * free spot beside that material instead.
	 */
	private absolute(pos: { x: number; y: number }, size: { w: number; h: number }, exclude?: Set<TLShapeId>) {
		const rect = { x: pos.x, y: pos.y, ...size }
		const obstacles = this.obstacles(exclude)
		const clear = !obstacles.some((o) => overlaps(rect, o, 10))
		const anchor = this.focusArea
		if (clear && (!anchor || distance(rect, anchor) <= FAR_FROM_FOCUS)) return { x: pos.x, y: pos.y }
		return placeNear(anchor ?? { x: pos.x, y: pos.y, w: 0, h: 0 }, size, 'right', obstacles)
	}

	/**
	 * The next line of working: right under `prevId`, its relation sign under the previous
	 * line's (left edges aligned when either line has none). If something is in the way, it
	 * falls back to an ordinary placement below.
	 */
	private nextLine(prevId: string, size: { w: number; h: number; relX?: number }, exclude?: Set<TLShapeId>) {
		const ref = this.bounds(prevId)
		if (!ref) throw new Error(`Unknown object ${prevId}`)
		const prev = this.editor.getShape(toShapeId(prevId))
		let x = ref.x
		if (prev?.type === EQUATION && size.relX !== undefined) {
			const p = (prev as EquationShape).props
			const prevRel = measureLatex(p.latex, EQUATION_FONT_SIZE[p.size]).relX
			if (prevRel !== undefined) x = ref.x + prevRel * (p.w / p.baseW) - size.relX
		}
		const rect = { x, y: ref.y + ref.h + LINE_GAP, w: size.w, h: size.h }
		if (!this.obstacles(exclude).some((o) => overlaps(o, rect))) return { x: rect.x, y: rect.y }
		return placeNear(ref, size, 'below', this.obstacles(exclude), LINE_GAP, 'start')
	}

	/** Re-place a just-created shape using its real measured size (text wraps unpredictably). */
	private settle(id: TLShapeId, pos: Position | undefined) {
		if (!pos || !('relativeTo' in pos || 'nextLineOf' in pos)) return
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

	/** Where an anchor is on the page, to look at it while talking about it (null if it is gone). */
	lookArea(a: Anchor): Rect | null {
		try {
			if ('objectId' in a) return this.bounds(a.objectId) ?? null
			const { point } = this.anchor(a)
			// A point outside its graph's range (a vector tip past the axes) is looked at from the
			// graph's edge, so the orb never flies off into empty board.
			const frame = 'graphId' in a ? this.bounds(a.graphId) : undefined
			if (frame) {
				point.x = Math.min(Math.max(point.x, frame.x), frame.x + frame.w)
				point.y = Math.min(Math.max(point.y, frame.y), frame.y + frame.h)
			}
			return { x: point.x, y: point.y, w: 0, h: 0 }
		} catch {
			return null
		}
	}

	/**
	 * Start the frame, and the place new work goes, from what the student pointed at (a region, or
	 * the selected question). If they zoomed out too far to read it, bring the camera in to it now.
	 */
	focusContext(ids: string[]) {
		const rects = ids.map((id) => this.bounds(id)).filter((r): r is Rect => Boolean(r))
		if (!rects.length) return
		this.turnArea = this.focusArea = union(rects)
		if (this.editor.getZoomLevel() < MIN_READABLE_ZOOM) frameArea(this.editor, this.turnArea)
	}

	/**
	 * Looking at something while talking about it: if the student can't see it (off screen, or the
	 * board zoomed out past readable), bring it into view along with this turn's work.
	 */
	look(area: Rect) {
		const vp = this.editor.getViewportPageBounds()
		const offScreen = !overlaps(area, { x: vp.x, y: vp.y, w: vp.w, h: vp.h })
		if (offScreen || this.editor.getZoomLevel() < MIN_READABLE_ZOOM) this.reveal(area)
	}

	/**
	 * How long the next piece of writing may take, so the pen keeps pace with the sentence being
	 * spoken about it rather than finishing early and waiting. Never shorter than the natural
	 * writing time.
	 */
	private writeBudget: number | undefined

	async execute(action: CanvasAction, opts: { writeMs?: number } = {}): Promise<void> {
		this.writeBudget = opts.writeMs
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
			case 'draw_table':
				return this.table(action)
			case 'update_table':
				return this.updateTable(action)
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
				if (!rects.length) return
				// Things spread across the board can't all be read at once: frame the first one named.
				const all = union(rects)
				frameArea(this.editor, fitZoom(this.editor, all) >= MIN_READABLE_ZOOM ? all : rects[0])
				return
			}
		}
	}

	private async writeText(action: ActionOf<'write_text'>) {
		await handFontReady()
		const size = action.size ?? 'm'
		const px = TEXT_PX[size]
		const maxW = action.maxWidth
		const longest = Math.max(...action.text.split('\n').map((l) => l.length))
		const estW = Math.min(maxW ?? 1e9, longest * px * 0.56 + 16)
		const estH = Math.ceil((longest * px * 0.56) / (maxW ?? 1e9) + action.text.split('\n').length) * px * 1.35
		const free = 'x' in action.position
		let pos = this.resolvePosition(action.position, { w: estW, h: estH })
		if (free) pos = clearSpot({ ...pos, w: estW, h: estH }, this.obstacles())
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
				font: 'draw',
				textAlign: 'start',
				autoSize: !maxW,
				...(maxW ? { w: maxW } : {}),
			},
		})
		if (free) this.clear(id)
		else this.settle(id, action.position)
		this.done(id)
		await this.write(id, action.text.length)
	}

	/** Write a just-created shape out by hand, the pen moving across it. */
	private async write(id: TLShapeId, chars: number) {
		const b = this.editor.getShapePageBounds(id)
		const natural = writingTime(chars)
		const ms = this.writeBudget ? Math.min(MAX_PACED_WRITE, Math.max(natural, this.writeBudget)) : natural
		console.log('[loci] PACE', id, 'natural', natural, 'budget', Math.round(this.writeBudget ?? 0), '->', Math.round(ms))
		if (b) await writeIn(id, { x: b.x, y: b.y, w: b.w, h: b.h }, ms)
	}

	private async writeEquation(action: ActionOf<'write_equation'>) {
		const size = action.size ?? 'm'
		await handFontReady()
		const m = measureLatex(action.latex, EQUATION_FONT_SIZE[size])
		let pos = this.resolvePosition(action.position, m)
		if ('x' in action.position) pos = clearSpot({ ...pos, w: m.w, h: m.h }, this.obstacles())
		await this.beforeDraw({ ...pos, ...m })
		const id = toShapeId(action.id!)
		this.editor.createShape<EquationShape>({
			id,
			type: EQUATION,
			x: pos.x,
			y: pos.y,
			meta: this.meta(),
			props: { latex: action.latex, color: action.color ?? 'ink', size, w: m.w, h: m.h, baseW: m.w, baseH: m.h },
		})
		this.done(id)
		await this.write(id, latexToPlain(action.latex).length)
	}

	private async highlight(action: ActionOf<'highlight'>) {
		const targetId = toShapeId(action.target)
		const target = this.editor.getShape(targetId)
		if (!target) return
		if (target.type === MATERIAL) this.focusArea ??= this.bounds(action.target) ?? null
		const id = toShapeId(action.id!)
		const style = action.style ?? 'marker'
		const color = action.color ?? (style === 'marker' ? 'yellow' : 'pink')
		markFresh(id)

		// In the target's own coordinates, and parented to it, so the mark moves with it.
		let local: Rect
		if (target.type === MATERIAL) {
			const { w, h } = (target as Extract<TLShape, { type: typeof MATERIAL }>).props
			const r = action.region ?? { x: 0, y: 0, w: 1, h: 1 }
			local = { x: r.x * w, y: r.y * h, w: Math.max(6, r.w * w), h: Math.max(6, r.h * h) }
		} else {
			const b = this.editor.getShapeGeometry(target).bounds
			const found = action.text ? textRectInShape(targetId, action.text) : null
			const r = action.region
			const cell = action.cell && target.type === TABLE ? cellRect((target as TableShape).props.colW, action.cell.row, action.cell.col) : null
			local = cell
				? { x: b.x + cell.x - 3, y: b.y + cell.y - 2, w: cell.w + 6, h: cell.h + 4 }
				: found
					? { x: found.x - 4, y: found.y - 2, w: found.w + 8, h: found.h + 4 }
					: r
						? { x: b.x + r.x * b.w, y: b.y + r.y * b.h, w: Math.max(6, r.w * b.w), h: Math.max(6, r.h * b.h) }
						: { x: b.x - 8, y: b.y - 6, w: b.w + 16, h: b.h + 12 }
		}
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
				font: 'draw',
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
		if (action.label) this.liftLabel(id, action.label, action.color, [from.point, to.point])
		this.done(id)
	}

	/**
	 * An arrow's label sits on its middle; on a short arrow it spills over the shapes at either end
	 * (a "points into" label across a box's border). Then write it as its own text beside the arrow,
	 * slid clear. Shapes holding both ends (a graph, a page) are where the arrow lives, not in its way.
	 */
	private liftLabel(id: TLShapeId, label: string, color: ActionOf<'draw_arrow'>['color'], ends: { x: number; y: number }[]) {
		const shape = this.editor.getShape(id)
		const geom = this.editor.getShapeGeometry(id)
		const box = shape && geom instanceof Group2d ? geom.children.find((g) => g.isLabel)?.bounds : undefined
		if (!shape || !box) return
		const rect = { x: shape.x + box.x, y: shape.y + box.y, w: box.w, h: box.h }
		const holds = (o: Rect) => ends.every((p) => p.x >= o.x && p.x <= o.x + o.w && p.y >= o.y && p.y <= o.y + o.h)
		if (!this.obstacles().some((o) => !holds(o) && blocks(rect, o))) return
		this.editor.updateShape<TLArrowShape>({ id, type: 'arrow', props: { richText: toRichText('') } })
		const labelId = createShapeId(`${toModelId(id)}-label`)
		this.editor.createShape<TLTextShape>({
			id: labelId,
			type: 'text',
			x: rect.x,
			y: rect.y,
			meta: this.meta(),
			props: { richText: toRichText(label), color: TL_COLOR[color ?? 'blue'], size: 's', font: 'draw', autoSize: true },
		})
		this.clear(labelId)
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
				font: 'draw',
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
				props: { richText: toRichText(action.label), color: TL_COLOR[action.color ?? 'blue'], size: 's', font: 'draw', autoSize: true },
			})
			this.clear(createShapeId(`${toModelId(id)}-label`))
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

	private async table(action: ActionOf<'draw_table'>) {
		await handFontReady()
		const cells = toCells(action.rows)
		const minW = action.widths ?? []
		const colW = columnWidths(action.columns, cells, minW)
		const size = tableSize(colW, cells.length)
		const pos = this.resolvePosition(action.position, size)
		await this.beforeDraw({ ...pos, ...size })
		const id = toShapeId(action.id!)
		this.editor.createShape<TableShape>({
			id,
			type: TABLE,
			x: pos.x,
			y: pos.y,
			meta: this.meta(),
			props: { ...size, columns: action.columns, cells, color: action.color ?? 'blue', minW, colW },
		})
		this.done(id)
		const chars = [...action.columns, ...cells.flat().map((c) => c.text)].join('').length
		await this.write(id, chars)
	}

	private async updateTable(action: ActionOf<'update_table'>) {
		const id = toShapeId(action.tableId)
		const t = this.editor.getShape<TableShape>(id)
		if (!t || t.type !== TABLE) return
		const cells = t.props.cells.map((row) => [...row])
		for (const c of action.cells) {
			if (!cells[c.row]?.[c.col]) continue
			cells[c.row][c.col] = c.text ? { text: c.text, by: 'tutor' } : { text: '', by: 'student' }
			markFresh(`${id}:${c.row}:${c.col}`)
		}
		const colW = columnWidths(t.props.columns, cells, t.props.minW)
		const first = action.cells[0]
		const at = cellRect(colW, first.row, first.col)
		await this.beforeDraw({ x: t.x + at.x, y: t.y + at.y, w: at.w, h: at.h })
		this.editor.updateShape<TableShape>({ id, type: TABLE, props: { cells, colW, ...tableSize(colW, cells.length) } })
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
