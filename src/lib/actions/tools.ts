/**
 * Turns the Zod action schemas into provider-neutral tool definitions
 * ({ name, description, inputSchema }) that any model provider can map to its own format.
 */
import { z } from 'zod'
import { toolInputSchemas, type ToolName } from './schema'

export interface ToolDefinition {
	name: ToolName
	description: string
	inputSchema: Record<string, unknown>
}

const DESCRIPTIONS: Record<ToolName, string> = {
	say: 'Speak to the student, out loud. This is the ONLY way your words reach them. One or two short spoken sentences in plain English (no LaTeX, symbols, markdown or dashes), interleaved with the drawing tools in the order you would say them at a whiteboard.',
	write_text: 'Write a short handwritten-style note on the canvas (a label, a one-line takeaway, a step name).',
	write_equation: 'Write a properly typeset LaTeX equation on the canvas as a movable object.',
	highlight:
		'Highlight, circle, box or underline part of the student\'s material (pdf page or image), or a whole object. Prefer `text` so Loci can find the exact spot.',
	draw_arrow: 'Draw an arrow connecting two objects, graph points or canvas points. Use it to tie a diagram to the source material or to an equation.',
	draw_line: 'Draw a plain line between two anchors.',
	draw_rectangle: 'Draw a rectangle, typically around a group of objects to frame a step or result.',
	draw_circle: 'Draw an ellipse, typically around objects to draw attention to them.',
	draw_axes:
		'Create a coordinate plane (a graph object) with equal x/y scale. Put vectors, points, functions, angles and projections in it with math coordinates.',
	add_to_graph: 'Add items to an existing graph, or replace items by reusing their ids. Prefer extending an existing graph over drawing a new one.',
	remove_from_graph: 'Remove items from a graph by item id.',
	draw_table:
		'Draw a ruled table (traces, truth tables, value tables, T-accounts). Fill the cells you give; leave cells null for the student to fill in by typing. Never fake a table with lines of text.',
	update_table: 'Write into (or clear) cells of a table you drew, by row and column. Cells the student typed in are theirs: mark a wrong one with highlight rather than overwriting it.',
	move_object: 'Move an object (usually one you created) to a new position.',
	delete_objects: 'Delete objects you created earlier, e.g. to replace a messy diagram. Never delete the student\'s material.',
	focus: 'Pan/zoom the student\'s view to show the given objects.',
}

/** Zod renders tuples as `prefixItems`; flatten them to plain fixed-length arrays for broad provider support. */
function simplify(node: unknown): unknown {
	if (Array.isArray(node)) return node.map(simplify)
	if (!node || typeof node !== 'object') return node
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(node)) {
		if (key === '$schema') continue
		out[key] = simplify(value)
	}
	if (Array.isArray(out.prefixItems)) {
		const items = out.prefixItems as unknown[]
		delete out.prefixItems
		out.items = items[0]
		out.minItems = items.length
		out.maxItems = items.length
	}
	return out
}

let cached: ToolDefinition[] | null = null

export function getToolDefinitions(): ToolDefinition[] {
	if (cached) return cached
	cached = (Object.keys(toolInputSchemas) as ToolName[]).map((name) => ({
		name,
		description: DESCRIPTIONS[name],
		inputSchema: simplify(z.toJSONSchema(toolInputSchemas[name], { io: 'input' })) as Record<string, unknown>,
	}))
	return cached
}
