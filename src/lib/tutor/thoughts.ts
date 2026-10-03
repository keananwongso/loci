/**
 * The tutor's "thought" while it works: one short line, rewritten as the model streams each tool
 * call. It is read from the call's arguments while they are still being written (partial JSON),
 * so it shows what the model is doing before the drawing is ready, without a thinking mode.
 * What the tutor will say is never shown here, so the voice is not spoiled.
 */
import type { TutorEvent } from './types'

export interface Thought {
	text: string
	/** Optional LaTeX shown after the text, e.g. the label of the vector being drawn. */
	latex?: string
}

/** A string field whose value has been fully streamed (closing quote seen), decoded. */
function field(args: string, key: string): string | undefined {
	const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'g')
	let last: string | undefined
	for (let m = re.exec(args); m; m = re.exec(args)) last = m[1]
	if (last === undefined) return undefined
	try {
		return JSON.parse(`"${last}"`) as string
	} catch {
		return undefined
	}
}

function clip(text: string, max = 36) {
	const t = text.replace(/\s+/g, ' ').trim()
	return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

const quote = (text: string) => `“${clip(text)}”`

/** The graph item currently being written: the last `kind` and the fields after it. */
function graphItem(args: string, base: Thought): Thought {
	const kinds = [...args.matchAll(/"kind"\s*:\s*"(\w+)"/g)]
	const last = kinds.at(-1)
	if (!last) return base
	const rest = args.slice(last.index)
	const label = field(rest, 'label') ?? field(rest, 'text')
	switch (last[1]) {
		case 'vector':
			return { text: label ? 'drawing the vector' : 'drawing a vector', latex: label }
		case 'point':
			return { text: label ? 'plotting the point' : 'plotting a point', latex: label }
		case 'segment':
			return { text: 'drawing a segment', latex: label }
		case 'function': {
			const expr = field(rest, 'expr')
			return expr ? { text: `plotting y = ${clip(expr, 28)}` } : { text: 'plotting a curve' }
		}
		case 'circle':
			return { text: 'adding a circle', latex: label }
		case 'angle':
			return { text: 'marking the angle', latex: label }
		case 'projection':
			return { text: 'projecting one onto the other' }
		case 'label':
			return { text: 'labelling it', latex: label }
		default:
			return base
	}
}

/** What a partly streamed tool call is doing, or null when it has nothing to show (`say`). */
export function thoughtFor(tool: string, args: string): Thought | null {
	switch (tool) {
		case 'say':
			return null
		case 'highlight': {
			const text = field(args, 'text')
			return { text: text ? `finding ${quote(text)}` : 'finding the spot in your notes' }
		}
		case 'write_equation': {
			const latex = field(args, 'latex')
			return latex ? { text: 'writing', latex } : { text: 'writing an equation' }
		}
		case 'write_text': {
			const text = field(args, 'text')
			return { text: text ? `noting ${quote(text)}` : 'writing a note' }
		}
		case 'draw_axes': {
			const title = field(args, 'title')
			return graphItem(args, { text: title ? `setting up ${quote(title)}` : 'setting up axes' })
		}
		case 'add_to_graph':
			return graphItem(args, { text: 'adding to the graph' })
		case 'remove_from_graph':
			return { text: 'tidying the graph' }
		case 'draw_arrow': {
			const label = field(args, 'label')
			return { text: label ? `connecting ${quote(label)}` : 'connecting the pieces' }
		}
		case 'draw_line':
			return { text: 'drawing a line' }
		case 'draw_rectangle':
		case 'draw_circle':
			return { text: 'framing the key part' }
		case 'move_object':
			return { text: 'making room' }
		case 'delete_objects':
			return { text: 'clearing the old sketch' }
		case 'focus':
			return { text: 'moving your view' }
		default:
			return null
	}
}

/**
 * Turns streamed tool-call fragments into `thought` events, sending one only when the line
 * actually changes. One per model turn.
 */
export class ThoughtStream {
	private calls = new Map<number | string, { tool: string; args: string }>()
	private last = ''

	constructor(private emit: (e: TutorEvent) => void) {}

	/** A fragment of tool call `key`: its name (once known) and/or more argument text. */
	update(key: number | string, fragment: { tool?: string; args?: string }) {
		const call = this.calls.get(key) ?? { tool: '', args: '' }
		if (fragment.tool) call.tool = fragment.tool
		if (fragment.args) call.args += fragment.args
		this.calls.set(key, call)
		if (!call.tool) return
		const thought = thoughtFor(call.tool, call.args)
		if (!thought) return
		const id = `${thought.text}\u0000${thought.latex ?? ''}`
		if (id === this.last) return
		this.last = id
		this.emit({ type: 'thought', ...thought })
	}
}
