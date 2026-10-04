'use client'
/**
 * Builds the tutor's view of the board: a structured, id-stable description of every object
 * (with full extracted text only for the material in focus) plus a few images. This is the
 * minimum context needed for one question; it is assembled fresh for each request.
 */
import { renderPlaintextFromRichText, type Editor, type TLShape } from 'tldraw'
import { groupLines, textInRegion } from '@/lib/documents/text'
import type { BoardContext, BoardObject, BoardObjectType, ContextImage } from '@/lib/tutor/types'
import { getBlob } from '@/lib/storage/blobs'
import { EQUATION, GRAPH, HIGHLIGHT, MATERIAL, REGION, type GraphShape, type MaterialShape } from './shape-types'
import { toModelId } from './executor'
import { overlaps, type Rect } from './placement'
import { isReference, roleOf } from '@/lib/documents/roles'

const MAX_OBJECTS = 250
/** Syllabus and mark scheme text sent per question when out of focus, in characters: per page and in all. */
const REFERENCE_PER_PAGE = 5000
const REFERENCE_TOTAL = 16000

function rectOf(editor: Editor, shape: TLShape): Rect | null {
	const b = editor.getShapePageBounds(shape)
	return b ? { x: b.x, y: b.y, w: b.w, h: b.h } : null
}

function richText(editor: Editor, shape: TLShape): string | undefined {
	const props = shape.props as { richText?: unknown }
	if (!props.richText) return undefined
	const text = renderPlaintextFromRichText(editor, props.richText as never).trim()
	return text || undefined
}

function intersection(a: Rect, b: Rect): number {
	const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
	const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
	return w > 0 && h > 0 ? w * h : 0
}

export interface FocusInfo {
	board: BoardContext
	/** Materials whose full text and image are sent. */
	focusMaterials: MaterialShape[]
	/** Region the student drew, in the focus material's normalised coordinates. */
	regionCrop?: { material: MaterialShape; normalized: Rect }
	hasAssistantInView: boolean
}

export function serializeBoard(editor: Editor): FocusInfo {
	const vp = editor.getViewportPageBounds()
	const viewport = { x: vp.x, y: vp.y, w: vp.w, h: vp.h }
	const shapes = editor.getCurrentPageShapesSorted()
	const selected = editor.getSelectedShapes()
	const selectedIds = new Set(selected.map((s) => s.id))

	// --- what is "this"?
	const materials = shapes.filter((s): s is MaterialShape => s.type === MATERIAL)
	const regionShape = selected.find((s) => s.type === REGION)
	let regionCrop: FocusInfo['regionCrop']
	let region: BoardContext['region']
	if (regionShape) {
		const rr = rectOf(editor, regionShape)!
		const best = materials
			.map((m) => ({ m, overlap: intersection(rr, rectOf(editor, m)!) }))
			.filter((x) => x.overlap > 0)
			.sort((a, b) => b.overlap - a.overlap)[0]
		region = { id: toModelId(regionShape.id), bounds: rr }
		if (best) {
			const mb = rectOf(editor, best.m)!
			const x0 = Math.max(0, (rr.x - mb.x) / mb.w)
			const y0 = Math.max(0, (rr.y - mb.y) / mb.h)
			const x1 = Math.min(1, (rr.x + rr.w - mb.x) / mb.w)
			const y1 = Math.min(1, (rr.y + rr.h - mb.y) / mb.h)
			const normalized = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
			regionCrop = { material: best.m, normalized }
			region = {
				...region,
				materialId: toModelId(best.m.id),
				normalized,
				text: textInRegion(best.m.props.textItems, normalized).slice(0, 3000) || undefined,
			}
		}
	}

	let focusMaterials: MaterialShape[] = []
	if (regionCrop) focusMaterials = [regionCrop.material]
	else {
		// A selected page, or the page a selected highlight/annotation sits on.
		for (const s of selected) {
			const m = s.type === MATERIAL ? s : editor.getShapeAncestors(s).find((a) => a.type === MATERIAL)
			if (m && !focusMaterials.includes(m as MaterialShape)) focusMaterials.push(m as MaterialShape)
		}
		if (!focusMaterials.length) {
			// Nothing specific selected: the most visible pages in view.
			focusMaterials = materials
				.map((m) => ({ m, v: intersection(viewport, rectOf(editor, m)!) }))
				.filter((x) => x.v > 0)
				.sort((a, b) => b.v - a.v)
				.slice(0, 2)
				.map((x) => x.m)
		}
	}
	focusMaterials = focusMaterials.slice(0, 3)
	const focusIds = new Set(focusMaterials.map((m) => m.id))

	// --- objects, nearest to the view first when there are many
	const cx = vp.x + vp.w / 2
	const cy = vp.y + vp.h / 2
	const ranked = shapes
		.map((s) => ({ s, r: rectOf(editor, s) }))
		.filter((x): x is { s: TLShape; r: Rect } => x.r !== null)
		.sort((a, b) => {
			const sa = selectedIds.has(a.s.id) || focusIds.has(a.s.id) ? -1e12 : 0
			const sb = selectedIds.has(b.s.id) || focusIds.has(b.s.id) ? -1e12 : 0
			const da = Math.hypot(a.r.x + a.r.w / 2 - cx, a.r.y + a.r.h / 2 - cy)
			const db = Math.hypot(b.r.x + b.r.w / 2 - cx, b.r.y + b.r.h / 2 - cy)
			return sa + da - (sb + db)
		})
		.slice(0, MAX_OBJECTS)

	let hasAssistantInView = false
	let referenceLeft = REFERENCE_TOTAL
	const objects: BoardObject[] = []
	for (const { s, r } of ranked) {
		const meta = s.meta as { author?: string; turn?: number }
		const author = meta.author === 'assistant' ? 'assistant' : 'user'
		if (author === 'assistant' && overlaps(r, viewport)) hasAssistantInView = true
		const parent = editor.getShapeParent(s)
		const base = {
			id: toModelId(s.id),
			author,
			bounds: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) },
			...(parent ? { parentId: toModelId(parent.id) } : {}),
			...(typeof meta.turn === 'number' ? { turn: meta.turn } : {}),
		} as const
		const obj = describeShape(editor, s, focusIds.has(s.id))
		if (obj?.material && !focusIds.has(s.id) && isReference(roleOf(s.meta)) && referenceLeft > 0) {
			const full = groupLines((s as MaterialShape).props.textItems)
				.map((l) => l.text)
				.join('\n')
				.slice(0, Math.min(REFERENCE_PER_PAGE, referenceLeft))
			if (full) {
				referenceLeft -= full.length
				obj.material = { ...obj.material, textPreview: undefined, referenceText: full }
			}
		}
		if (obj) objects.push({ ...base, ...obj } as BoardObject)
	}

	return {
		board: { viewport, selectedIds: selected.map((s) => toModelId(s.id)), region, objects },
		focusMaterials,
		regionCrop,
		hasAssistantInView,
	}
}

function describeShape(editor: Editor, s: TLShape, inFocus: boolean): Partial<BoardObject> & { type: BoardObjectType } | null {
	switch (s.type) {
		case MATERIAL: {
			const p = (s as MaterialShape).props
			const text = inFocus ? undefined : groupLines(p.textItems).map((l) => l.text).join(' ').slice(0, 300)
			return {
				type: p.kind,
				material: {
					kind: p.kind,
					name: p.name,
					role: roleOf(s.meta),
					page: p.page,
					pageCount: p.pageCount,
					pixelSize: [p.pixelW, p.pixelH],
					...(inFocus ? { textItems: p.textItems } : text ? { textPreview: text } : {}),
				},
			}
		}
		case EQUATION:
			return { type: 'equation', latex: (s as Extract<TLShape, { type: typeof EQUATION }>).props.latex }
		case GRAPH: {
			const p = (s as GraphShape).props
			return { type: 'graph', graph: { xRange: [p.xMin, p.xMax], yRange: [p.yMin, p.yMax], title: p.title || undefined, items: p.items } }
		}
		case HIGHLIGHT:
			return { type: 'highlight', highlight: { style: (s as Extract<TLShape, { type: typeof HIGHLIGHT }>).props.style } }
		case REGION:
			return { type: 'region' }
		case 'text':
			return { type: 'text', text: richText(editor, s) }
		case 'note':
			return { type: 'note', text: richText(editor, s) }
		case 'arrow': {
			const bindings = editor.getBindingsFromShape(s, 'arrow') as Array<{ toId: string; props: { terminal: string } }>
			const from = bindings.find((b) => b.props.terminal === 'start')
			const to = bindings.find((b) => b.props.terminal === 'end')
			const head = (s.props as { arrowheadEnd?: string }).arrowheadEnd
			return {
				type: head === 'none' ? 'line' : 'arrow',
				label: richText(editor, s),
				connector: { from: from ? toModelId(from.toId) : undefined, to: to ? toModelId(to.toId) : undefined },
			}
		}
		case 'geo': {
			const geo = (s.props as { geo: string }).geo
			return { type: geo === 'rectangle' ? 'rectangle' : geo === 'ellipse' ? 'ellipse' : 'shape', label: richText(editor, s) }
		}
		case 'draw':
		case 'highlight':
		case 'line':
			return { type: 'drawing' }
		case 'image':
			return { type: 'image' }
		default:
			return { type: 'other' }
	}
}

// ---------------------------------------------------------------------------
// Images

async function loadBitmap(material: MaterialShape) {
	const blob = await getBlob(material.props.blobKey)
	return blob ? createImageBitmap(blob) : null
}

function encode(canvas: HTMLCanvasElement, label: string): ContextImage {
	const url = canvas.toDataURL('image/jpeg', 0.85)
	return { label, mediaType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1), width: canvas.width, height: canvas.height }
}

function drawScaled(source: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, maxSide: number, minSide = 0) {
	let scale = Math.min(1, maxSide / Math.max(sw, sh))
	if (minSide && Math.max(sw, sh) * scale < minSide) scale = Math.min(2, minSide / Math.max(sw, sh))
	const canvas = document.createElement('canvas')
	canvas.width = Math.max(1, Math.round(sw * scale))
	canvas.height = Math.max(1, Math.round(sh * scale))
	const ctx = canvas.getContext('2d')!
	ctx.fillStyle = '#fff'
	ctx.fillRect(0, 0, canvas.width, canvas.height)
	ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
	return canvas
}

/** Page images / region crop / viewport screenshot for the current question. */
export async function captureImages(editor: Editor, focus: FocusInfo): Promise<ContextImage[]> {
	const images: ContextImage[] = []
	try {
		if (focus.regionCrop) {
			const { material, normalized: n } = focus.regionCrop
			const bmp = await loadBitmap(material)
			if (bmp) {
				const label = `${toModelId(material.id)}`
				images.push(
					encode(
						drawScaled(bmp, n.x * bmp.width, n.y * bmp.height, n.w * bmp.width, n.h * bmp.height, 1400, 900),
						`Close-up of the region the student selected on ${label}. Crop bounds in FULL-page coordinates: ${JSON.stringify(n)}. For highlight regions, convert close-up coordinates (u, v, width, height) to {x: ${n.x} + u * ${n.w}, y: ${n.y} + v * ${n.h}, w: width * ${n.w}, h: height * ${n.h}}; do not use close-up coordinates directly.`
					)
				)
				images.push(encode(drawScaled(bmp, 0, 0, bmp.width, bmp.height, 1100), `Full page ${label} for context`))
				bmp.close()
			}
		} else {
			for (const m of focus.focusMaterials.slice(0, 2)) {
				const bmp = await loadBitmap(m)
				if (!bmp) continue
				const what = m.props.kind === 'pdf' ? `Page ${m.props.page} of "${m.props.name}"` : `Image "${m.props.name}"`
				images.push(encode(drawScaled(bmp, 0, 0, bmp.width, bmp.height, 1400), `${what} (object ${toModelId(m.id)})`))
				bmp.close()
			}
		}

		// Let the tutor see its own earlier drawings (and anything the student sketched) in context.
		const vp = editor.getViewportPageBounds()
		const visible = editor.getCurrentPageShapes().filter((s) => {
			const b = editor.getShapePageBounds(s)
			return b && overlaps({ x: b.x, y: b.y, w: b.w, h: b.h }, vp)
		})
		const hasSketches = visible.some((s) => ['draw', 'geo', 'text', 'arrow', 'note', 'line', 'highlight'].includes(s.type))
		if (visible.length && (focus.hasAssistantInView || hasSketches || !focus.focusMaterials.length)) {
			const scale = Math.min(1, 1400 / vp.w)
			const { url, width, height } = await editor.toImageDataUrl(visible, {
				bounds: vp,
				format: 'jpeg',
				quality: 0.8,
				scale,
				background: true,
				padding: 0,
			})
			images.push({
				label: `Screenshot of the student's current view (canvas x ${Math.round(vp.x)}..${Math.round(vp.x + vp.w)}, y ${Math.round(vp.y)}..${Math.round(vp.y + vp.h)})`,
				mediaType: 'image/jpeg',
				data: url.slice(url.indexOf(',') + 1),
				width,
				height,
			})
		}
	} catch (err) {
		console.warn('[loci] could not capture visual context', err)
	}
	return images.slice(0, 4)
}
