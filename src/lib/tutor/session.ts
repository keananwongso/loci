/**
 * One tutoring turn's tool-call handler, shared by every model provider.
 *
 * Each tool call the model makes is checked here twice: against its Zod schema, and against
 * the live board (do referenced ids exist? does the LaTeX compile? can the quoted text be
 * found?). Valid calls are normalised (ids assigned, text matched to a region) and emitted to
 * the browser; invalid ones produce a precise error the model sees as the tool result, so it
 * can correct itself in the same turn. Nothing the model writes is ever executed as code.
 */
import katex from 'katex'
import { z } from 'zod'
import {
	toolInputSchemas,
	type CanvasAction,
	type GraphItem,
	type Position,
	type Anchor,
	type ToolName,
} from '@/lib/actions/schema'
import { compileExpression } from '@/lib/math/expr'
import { toSpoken } from '@/lib/voice/spoken'
import { equalAspectHeight } from '@/lib/math/graph'
import { findTextBox, groupLines } from '@/lib/documents/text'
import type { BoardContext, BoardObject, TextItem, TutorEvent } from './types'

export type ToolCallResult = { ok: true; result: string } | { ok: false; error: string }

interface GraphState {
	items: Map<string, GraphItem>
	xRange: [number, number]
	yRange: [number, number]
}

const ID_PREFIX: Partial<Record<ToolName, string>> = {
	write_text: 'note',
	write_equation: 'eq',
	highlight: 'hl',
	draw_arrow: 'arrow',
	draw_line: 'line',
	draw_rectangle: 'box',
	draw_circle: 'ring',
	draw_axes: 'graph',
}

export class ActionSession {
	/** The model began saying again what it already said; refuse sentences until it draws. */
	private repeating = false
	private ids = new Set<string>()
	private assistantIds = new Set<string>()
	private materials = new Map<string, { textItems?: TextItem[]; kind: string }>()
	private graphs = new Map<string, GraphState>()
	private region: BoardContext['region']
	readonly summaries: string[] = []
	readonly spoken: string[] = []

	/** The answer has reached its end: the last thing said was a question (the check, or an invitation). */
	endsOnQuestion(): boolean {
		return Boolean(this.spoken.at(-1)?.trim().endsWith('?'))
	}

	constructor(
		board: BoardContext,
		private emit: (event: TutorEvent) => void
	) {
		this.region = board.region
		for (const obj of board.objects) this.register(obj)
	}

	private register(obj: BoardObject) {
		this.ids.add(obj.id)
		if (obj.author === 'assistant') this.assistantIds.add(obj.id)
		if (obj.material) this.materials.set(obj.id, { textItems: obj.material.textItems, kind: obj.material.kind })
		if (obj.graph) {
			this.graphs.set(obj.id, {
				items: new Map(obj.graph.items.map((it) => [it.id, it])),
				xRange: obj.graph.xRange,
				yRange: obj.graph.yRange,
			})
		}
	}

	/** Handle one tool call. Never throws for bad model input. */
	handle(name: string, rawInput: unknown): ToolCallResult {
		if (!Object.hasOwn(toolInputSchemas, name)) {
			return { ok: false, error: `Unknown tool "${name}". Available: ${Object.keys(toolInputSchemas).join(', ')}.` }
		}
		const tool = name as ToolName
		const parsed = toolInputSchemas[tool].safeParse(rawInput)
		if (!parsed.success) return { ok: false, error: `Invalid input for ${tool}: ${z.prettifyError(parsed.error)}` }

		try {
			let action = { type: tool, ...parsed.data } as CanvasAction
			// A sentence is never lost over where it points: speak it, just without looking.
			let lookNote = ''
			if (action.type === 'say' && action.look_at && this.missingRefs(action).length) {
				lookNote = ` (look_at ignored: unknown id ${this.missingRefs(action).join(', ')})`
				const { look_at: _, ...rest } = action
				action = rest
			}
			const outcome = this.check(action)
			if (!outcome.ok) {
				this.emit({ type: 'rejected', tool, reason: outcome.error })
				return outcome
			}
			if (action.type === 'say') {
				const text = toSpoken(action.text)
				if (!text) return { ok: true, result: 'Said nothing: the text was empty once markup was removed.' }
				if (this.repeating || this.spoken.some((prev) => repeats(prev, text))) {
					// A repeat means the model is answering again; the rest of that re-answer goes too.
					this.repeating = true
					this.emit({ type: 'rejected', tool, reason: 'repeats an earlier sentence' })
					return {
						ok: false,
						error: 'Not said: this repeats something you already said this turn, and the student heard it. Never repeat or rephrase yourself. Say only something new, or stop.',
					}
				}
				this.spoken.push(text)
				this.emit({ type: 'say', text, ...(action.look_at ? { look: action.look_at } : {}) })
				return { ok: true, result: `Said aloud.${lookNote} Carry on with the rest of the answer (the drawing and what comes next); stop only when the whole answer is done, and never repeat this sentence.` }
			}
			this.repeating = false
			const summary = summarize(outcome.action)
			this.summaries.push(summary)
			this.emit({ type: 'action', action: outcome.action, summary })
			return { ok: true, result: outcome.result }
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err)
			return { ok: false, error }
		}
	}

	// -------------------------------------------------------------------------

	private check(action: CanvasAction): { ok: true; action: CanvasAction; result: string } | { ok: false; error: string } {
		const fail = (error: string) => ({ ok: false as const, error })
		const missing = this.missingRefs(action)
		if (missing.length) {
			return fail(
				`Unknown object id(s): ${missing.join(', ')}. Use ids exactly as listed in the board state or ids you created this turn.`
			)
		}

		switch (action.type) {
			case 'say':
				return { ok: true, action, result: 'Said.' }

			case 'write_equation': {
				const err = latexError(action.latex)
				if (err) return fail(`LaTeX did not compile: ${err}. Fix the LaTeX and call write_equation again.`)
				return this.created(action)
			}

			case 'write_text':
				return this.created(action)

			case 'highlight': {
				const material = this.materials.get(action.target)
				let region = action.region
				if (action.text) {
					if (!material?.textItems?.length) {
						if (!region) {
							return fail(
								`"${action.target}" has no extracted text${material ? ' (it is an image or out of focus)' : ''}. Use \`region\` (normalised 0..1 coordinates, judged from the image) instead of \`text\`.`
							)
						}
					} else {
						const near = this.region?.materialId === action.target ? this.region.normalized : undefined
						const found = findTextBox(material.textItems, action.text, near)
						if (found) region = found
						else if (!region) {
							const lines = groupLines(material.textItems)
								.slice(0, 60)
								.map((l) => l.text)
								.filter(Boolean)
							return fail(
								`Could not find "${action.text}" in ${action.target}. Quote a shorter exact substring of one of its lines, or pass \`region\`. Lines: ${JSON.stringify(lines).slice(0, 1800)}`
							)
						}
					}
				}
				return this.created({ ...action, region })
			}

			case 'draw_arrow':
			case 'draw_line':
				return this.created(action)

			case 'draw_rectangle':
			case 'draw_circle': {
				if (!action.around && !(action.position && action.width && action.height)) {
					return fail('Give either `around` (object ids) or `position` + `width` + `height`.')
				}
				return this.created(action)
			}

			case 'draw_axes': {
				const [x0, x1] = action.xRange
				const [y0, y1] = action.yRange
				if (!(x1 > x0) || !(y1 > y0)) return fail('Ranges must be increasing: [min, max].')
				const width = action.width ?? 420
				const h = equalAspectHeight(width, action.xRange, action.yRange)
				if (h > 1800 || h < 60) {
					return fail(
						`With equal x/y scale these ranges make the graph ${Math.round(width)}×${Math.round(h)} units. Choose ranges with a closer aspect ratio, or change width.`
					)
				}
				for (const label of [action.xLabel, action.yLabel]) {
					const err = label ? latexError(label) : null
					if (err) return fail(`Axis label LaTeX did not compile: ${err}`)
				}
				const id = this.claimId(action)
				const state: GraphState = { items: new Map(), xRange: action.xRange, yRange: action.yRange }
				const items = action.items ?? []
				const err = checkGraphItems(state, items)
				if (err) return fail(err)
				for (const it of items) state.items.set(it.id, it)
				this.graphs.set(id, state)
				return { ok: true, action: { ...action, id }, result: `Created graph "${id}".` }
			}

			case 'add_to_graph': {
				const state = this.graphs.get(action.graphId)
				if (!state) return fail(`"${action.graphId}" is not a graph. Graph ids on the board: ${[...this.graphs.keys()].join(', ') || 'none'}.`)
				const err = checkGraphItems(state, action.items)
				if (err) return fail(err)
				for (const it of action.items) state.items.set(it.id, it)
				return { ok: true, action, result: `Added ${action.items.map((i) => i.id).join(', ')} to ${action.graphId}.` }
			}

			case 'remove_from_graph': {
				const state = this.graphs.get(action.graphId)
				if (!state) return fail(`"${action.graphId}" is not a graph.`)
				for (const id of action.itemIds) state.items.delete(id)
				return { ok: true, action, result: 'Removed.' }
			}

			case 'move_object':
			case 'delete_objects': {
				const ids = action.type === 'move_object' ? [action.id] : action.ids
				const foreign = ids.filter((id) => !this.assistantIds.has(id))
				if (foreign.length) {
					return fail(`You can only ${action.type === 'move_object' ? 'move' : 'delete'} objects you created. Not yours: ${foreign.join(', ')}.`)
				}
				if (action.type === 'delete_objects') {
					for (const id of ids) {
						this.ids.delete(id)
						this.assistantIds.delete(id)
						this.graphs.delete(id)
					}
				}
				return { ok: true, action, result: 'Done.' }
			}

			case 'focus':
				return { ok: true, action, result: 'Done.' }
		}
	}

	private created<A extends CanvasAction & { id?: string }>(action: A) {
		const id = this.claimId(action)
		return { ok: true as const, action: { ...action, id } as CanvasAction, result: `Created "${id}".` }
	}

	/** Assign a fresh id, or de-duplicate a requested one. */
	private claimId(action: CanvasAction & { id?: string }): string {
		let base = action.id ?? `${ID_PREFIX[action.type] ?? 'obj'}-1`
		if (this.ids.has(base)) {
			const stem = base.replace(/-\d+$/, '')
			let n = 2
			while (this.ids.has(`${stem}-${n}`)) n++
			base = `${stem}-${n}`
		}
		this.ids.add(base)
		this.assistantIds.add(base)
		return base
	}

	private missingRefs(action: CanvasAction): string[] {
		const refs: string[] = []
		const pos = (p?: Position) => {
			if (!p) return
			if ('relativeTo' in p) refs.push(p.relativeTo)
			if ('graphId' in p) refs.push(p.graphId)
		}
		const anchor = (a: Anchor) => {
			if ('objectId' in a) refs.push(a.objectId)
			if ('graphId' in a) refs.push(a.graphId)
		}
		switch (action.type) {
			case 'say':
				if (action.look_at) anchor(action.look_at)
				break
			case 'write_text':
			case 'write_equation':
			case 'draw_axes':
				pos(action.position)
				break
			case 'move_object':
				refs.push(action.id)
				pos(action.position)
				break
			case 'highlight':
				refs.push(action.target)
				break
			case 'draw_arrow':
			case 'draw_line':
				anchor(action.from)
				anchor(action.to)
				break
			case 'draw_rectangle':
			case 'draw_circle':
				refs.push(...(action.around ?? []))
				pos(action.position)
				break
			case 'add_to_graph':
			case 'remove_from_graph':
				refs.push(action.graphId)
				break
			case 'delete_objects':
			case 'focus':
				refs.push(...action.ids)
				break
		}
		return [...new Set(refs.filter((id) => !this.ids.has(id)))]
	}
}

function checkGraphItems(state: GraphState, items: GraphItem[]): string | null {
	const all = new Map(state.items)
	for (const it of items) all.set(it.id, it)
	for (const it of items) {
		if ('label' in it && it.label) {
			const err = latexError(it.label)
			if (err) return `Label of item "${it.id}" is not valid LaTeX: ${err}`
		}
		if (it.kind === 'label') {
			const err = latexError(it.text)
			if (err) return `Label item "${it.id}" is not valid LaTeX: ${err}`
		}
		if (it.kind === 'function') {
			try {
				compileExpression(it.expr)
			} catch (err) {
				return `Function "${it.id}": ${(err as Error).message}`
			}
		}
		if (it.kind === 'angle' || it.kind === 'projection') {
			const refs = it.kind === 'angle' ? it.between : [it.of, it.onto]
			for (const ref of refs) {
				const target = all.get(ref)
				if (!target || target.kind !== 'vector') return `Item "${it.id}" must reference vector items in this graph; "${ref}" is not one.`
			}
		}
	}
	return null
}

/** Returns a readable error if KaTeX cannot render the input, else null. */
export function latexError(latex: string): string | null {
	try {
		katex.renderToString(latex, { throwOnError: true, strict: 'ignore', trust: false })
		return null
	} catch (err) {
		return err instanceof Error ? err.message.replace(/^KaTeX parse error: /, '') : String(err)
	}
}

/** One-line description of an action, used for conversation history. */
export function summarize(action: CanvasAction): string {
	const id = 'id' in action && action.id ? ` ${action.id}` : ''
	switch (action.type) {
		case 'write_text':
			return `write_text${id}: "${action.text.slice(0, 80)}"`
		case 'write_equation':
			return `write_equation${id}: ${action.latex.slice(0, 120)}`
		case 'highlight':
			return `highlight${id} on ${action.target}${action.text ? `: "${action.text}"` : ''} (${action.style ?? 'marker'})`
		case 'draw_arrow':
		case 'draw_line':
			return `${action.type}${id}${action.label ? ` "${action.label}"` : ''}`
		case 'draw_axes':
			return `draw_axes${id} x∈[${action.xRange}] y∈[${action.yRange}]${action.items?.length ? ` with ${action.items.map((i) => `${i.kind} ${i.id}`).join(', ')}` : ''}`
		case 'add_to_graph':
			return `add_to_graph ${action.graphId}: ${action.items.map((i) => `${i.kind} ${i.id}${'label' in i && i.label ? ` (${i.label})` : ''}`).join(', ')}`
		case 'remove_from_graph':
			return `remove_from_graph ${action.graphId}: ${action.itemIds.join(', ')}`
		case 'move_object':
			return `move_object ${action.id}`
		case 'delete_objects':
			return `delete_objects ${action.ids.join(', ')}`
		case 'focus':
			return `focus ${action.ids.join(', ')}`
		default:
			return `${action.type}${id}`
	}
}

const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean)

/** `next` says again what `prev` already said: the same first sentence, or mostly the same words. */
export function repeats(prev: string, next: string): boolean {
	const first = (t: string) => words(t.split(/[.?!]/)[0]).join(' ')
	const a = first(prev)
	if (a.split(' ').length >= 3 && a === first(next)) return true
	const pa = new Set(words(prev))
	const pb = new Set(words(next))
	if (pa.size < 5 || pb.size < 5) return false
	let shared = 0
	for (const w of pb) if (pa.has(w)) shared++
	return shared / (pa.size + pb.size - shared) >= 0.6
}
