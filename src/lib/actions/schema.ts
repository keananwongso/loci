/**
 * The declarative canvas action protocol.
 *
 * The model never touches editor state directly. It calls these tools; every call is
 * validated against these schemas (and then against the live board in `validate.ts`)
 * before the browser turns it into native tldraw shapes in `canvas/executor.ts`.
 *
 * One schema per tool. The tool's JSON schema for the model is generated from the same
 * Zod object, so the contract cannot drift between what we advertise and what we accept.
 */
import { z } from 'zod'

const LIMIT = 100_000
const coord = z.number().finite().min(-LIMIT).max(LIMIT)
const size = z.number().finite().min(4).max(4000)
const mathCoord = z.number().finite().min(-1e4).max(1e4)

export const ObjectId = z
	.string()
	.regex(/^[A-Za-z0-9_-]{1,64}$/, 'ids may only contain letters, digits, "-" and "_" (max 64 chars)')
	.describe('A canvas object id, exactly as it appears in the board state.')

const NewId = ObjectId.describe(
	'Optional stable id for the new object (e.g. "eq-dot-product"). Reuse it later to refer to the object. Generated if omitted.'
)

export const InkColor = z
	.enum(['ink', 'blue', 'red', 'green', 'orange', 'violet', 'grey'])
	.describe('ink = near-black. Tutor annotations default to blue; use one accent colour per concept and keep it consistent.')

export const HighlightColor = z.enum(['yellow', 'green', 'blue', 'pink'])

export const Vec2 = z.tuple([mathCoord, mathCoord]).describe('[x, y] in the graph\'s math coordinates')

export const PagePoint = z.object({ x: coord, y: coord }).strict()

export const Placement = z.enum(['right', 'left', 'above', 'below', 'center'])

export const Position = z
	.union([
		z
			.object({
				relativeTo: ObjectId,
				placement: Placement,
				gap: z.number().min(0).max(600).optional().describe('Space between the objects in canvas units (default 48).'),
				align: z
					.enum(['start', 'center', 'end'])
					.optional()
					.describe('Alignment along the other axis. start = top/left edges aligned (default).'),
			})
			.strict()
			.describe(
				'Preferred. Place next to an existing object; Loci computes exact coordinates and slides the new object past anything already there.'
			),
		z
			.object({
				graphId: ObjectId,
				at: Vec2,
			})
			.strict()
			.describe('Place the object\'s top-left corner at a math coordinate of an existing graph.'),
		PagePoint.describe('Absolute canvas coordinates of the top-left corner. Use only when you need precise control.'),
	])
	.describe('Where to put the object.')

export const Anchor = z
	.union([
		z
			.object({
				objectId: ObjectId,
				side: z
					.enum(['center', 'top', 'bottom', 'left', 'right'])
					.optional()
					.describe('Which part of the object to attach to (default: nearest edge, chosen by the canvas).'),
			})
			.strict()
			.describe('Attach to an object. The connection follows the object when it moves.'),
		z
			.object({ graphId: ObjectId, point: Vec2 })
			.strict()
			.describe('Attach to a precise math coordinate inside a graph.'),
		PagePoint.describe('A free point in canvas coordinates.'),
	])
	.describe('One end of a connector.')

const NormalizedRegion = z
	.object({
		x: z.number().min(0).max(1),
		y: z.number().min(0).max(1),
		w: z.number().min(0.002).max(1),
		h: z.number().min(0.002).max(1),
	})
	.strict()
	.describe('Region inside the target, normalised 0..1 from its top-left corner.')

const Label = z.string().max(200)
const LatexLabel = z
	.string()
	.max(200)
	.describe('Rendered as LaTeX math, e.g. "u", "\\nabla f", "\\theta". Wrap words in \\text{...}.')

// ---------------------------------------------------------------------------
// Graph items: everything drawn inside a coordinate plane, in math coordinates.

const itemId = ObjectId.describe('Id of this item, unique within the graph. Reusing an id replaces that item.')

export const GraphItem = z.discriminatedUnion('kind', [
	z
		.object({
			kind: z.literal('vector'),
			id: itemId,
			from: Vec2.optional().describe('Tail, default [0, 0].'),
			to: Vec2.describe('Head of the vector.'),
			label: LatexLabel.optional(),
			color: InkColor.optional(),
		})
		.strict(),
	z
		.object({
			kind: z.literal('point'),
			id: itemId,
			at: Vec2,
			label: LatexLabel.optional(),
			color: InkColor.optional(),
		})
		.strict(),
	z
		.object({
			kind: z.literal('segment'),
			id: itemId,
			from: Vec2,
			to: Vec2,
			label: LatexLabel.optional(),
			color: InkColor.optional(),
			dashed: z.boolean().optional(),
		})
		.strict(),
	z
		.object({
			kind: z.literal('function'),
			id: itemId,
			expr: z
				.string()
				.min(1)
				.max(200)
				.describe(
					'y as a function of x, e.g. "x^2 - 1", "sin(2*x)", "exp(-x^2/2)". Supports + - * / ^, sin cos tan asin acos atan sinh cosh tanh exp log ln sqrt abs floor ceil min max, pi, e. Sampled automatically.'
				),
			domain: Vec2.optional().describe('[xMin, xMax]; defaults to the graph\'s x range.'),
			label: LatexLabel.optional(),
			color: InkColor.optional(),
			dashed: z.boolean().optional(),
		})
		.strict(),
	z
		.object({
			kind: z.literal('circle'),
			id: itemId,
			center: Vec2,
			radius: z.number().positive().max(1e4),
			label: LatexLabel.optional(),
			color: InkColor.optional(),
			dashed: z.boolean().optional(),
		})
		.strict()
		.describe('A circle in math units, e.g. the unit circle of all possible unit vectors, or a level curve.'),
	z
		.object({
			kind: z.literal('angle'),
			id: itemId,
			between: z.tuple([ObjectId, ObjectId]).describe('Ids of two vector items in this graph that share a tail.'),
			label: LatexLabel.optional(),
			color: InkColor.optional(),
		})
		.strict()
		.describe('Arc marking the angle between two vectors.'),
	z
		.object({
			kind: z.literal('projection'),
			id: itemId,
			of: ObjectId.describe('Vector item being projected.'),
			onto: ObjectId.describe('Vector item it is projected onto.'),
			label: LatexLabel.optional(),
			color: InkColor.optional(),
		})
		.strict()
		.describe(
			'Dashed drop-line from the tip of `of` to the line of `onto`, plus a bold segment showing the scalar projection. Ideal for dot products.'
		),
	z
		.object({
			kind: z.literal('label'),
			id: itemId,
			at: Vec2,
			text: LatexLabel,
			color: InkColor.optional(),
		})
		.strict(),
])
export type GraphItem = z.infer<typeof GraphItem>

// ---------------------------------------------------------------------------
// Tools

export const toolInputSchemas = {
	say: z
		.object({
			text: z
				.string()
				.min(1)
				.max(1500)
				.describe('Exactly the words to speak, written for the ear: plain sentences, math said in words ("the gradient of f", "three fifths"), no LaTeX, symbols, markdown or dashes.'),
		})
		.strict(),

	write_text: z
		.object({
			id: NewId.optional(),
			text: z.string().min(1).max(600).describe('Short plain text (unicode math symbols are fine). Use write_equation for formulas.'),
			position: Position,
			size: z.enum(['s', 'm', 'l']).optional().describe('Default m.'),
			color: InkColor.optional(),
			maxWidth: z.number().min(80).max(1200).optional().describe('Wrap text at this width.'),
		})
		.strict(),

	write_equation: z
		.object({
			id: NewId.optional(),
			latex: z.string().min(1).max(600).describe('KaTeX-compatible LaTeX, without surrounding $ signs.'),
			position: Position,
			size: z.enum(['s', 'm', 'l']).optional().describe('Default m.'),
			color: InkColor.optional(),
		})
		.strict(),

	highlight: z
		.object({
			id: NewId.optional(),
			target: ObjectId.describe('The object to mark up, usually a pdf page or image.'),
			text: z
				.string()
				.min(1)
				.max(200)
				.optional()
				.describe(
					'Exact text to find in the target\'s extracted text (copy it from the text lines). Loci locates it precisely.'
				),
			region: NormalizedRegion.optional().describe(
				'Use when the target has no extracted text (images) or text matching fails. Normalised to the target.'
			),
			style: z
				.enum(['marker', 'box', 'circle', 'underline'])
				.optional()
				.describe('marker = translucent highlighter (default); circle = hand-drawn ring for "look here"; box = outline; underline.'),
			color: HighlightColor.optional(),
		})
		.strict()
		.describe('Mark part of an object. Give `text` or `region`; with neither, the whole object is marked.'),

	draw_arrow: z
		.object({
			id: NewId.optional(),
			from: Anchor,
			to: Anchor,
			label: Label.optional(),
			color: InkColor.optional(),
			dashed: z.boolean().optional(),
			bend: z.number().min(-300).max(300).optional().describe('Curvature in canvas units; 0 = straight (default).'),
		})
		.strict(),

	draw_line: z
		.object({
			id: NewId.optional(),
			from: Anchor,
			to: Anchor,
			label: Label.optional(),
			color: InkColor.optional(),
			dashed: z.boolean().optional(),
		})
		.strict(),

	draw_rectangle: z
		.object({
			id: NewId.optional(),
			around: z.array(ObjectId).min(1).max(20).optional().describe('Draw around these objects (padding added).'),
			position: Position.optional(),
			width: size.optional(),
			height: size.optional(),
			label: Label.optional(),
			color: InkColor.optional(),
			dashed: z.boolean().optional(),
		})
		.strict()
		.describe('Either `around`, or `position` + `width` + `height`.'),

	draw_circle: z
		.object({
			id: NewId.optional(),
			around: z.array(ObjectId).min(1).max(20).optional().describe('Draw an ellipse around these objects.'),
			position: Position.optional(),
			width: size.optional(),
			height: size.optional(),
			label: Label.optional(),
			color: InkColor.optional(),
			dashed: z.boolean().optional(),
		})
		.strict()
		.describe('Either `around`, or `position` + `width` + `height`.'),

	draw_axes: z
		.object({
			id: NewId.optional(),
			position: Position,
			width: z.number().min(160).max(1600).optional().describe('Width in canvas units (default 420). Height follows from the ranges so that x and y share one scale.'),
			xRange: Vec2.describe('[xMin, xMax]'),
			yRange: Vec2.describe('[yMin, yMax]'),
			grid: z.boolean().optional().describe('Default true.'),
			xLabel: LatexLabel.optional(),
			yLabel: LatexLabel.optional(),
			title: Label.optional(),
			items: z.array(GraphItem).max(40).optional().describe('Initial contents. You can also add them later with add_to_graph.'),
		})
		.strict()
		.describe('Create a coordinate plane. Everything inside it is drawn in math coordinates via graph items.'),

	add_to_graph: z
		.object({
			graphId: ObjectId,
			items: z.array(GraphItem).min(1).max(40),
		})
		.strict()
		.describe('Add (or replace, by item id) vectors, points, functions, angles, projections... in an existing graph.'),

	remove_from_graph: z
		.object({
			graphId: ObjectId,
			itemIds: z.array(ObjectId).min(1).max(40),
		})
		.strict(),

	move_object: z
		.object({
			id: ObjectId,
			position: Position,
		})
		.strict(),

	delete_objects: z
		.object({
			ids: z.array(ObjectId).min(1).max(40),
		})
		.strict()
		.describe('Delete objects you created earlier. You cannot delete the student\'s material.'),

	focus: z
		.object({
			ids: z.array(ObjectId).min(1).max(40),
		})
		.strict()
		.describe('Move the student\'s view so these objects are visible.'),
} as const

export type ToolName = keyof typeof toolInputSchemas
export const TOOL_NAMES = Object.keys(toolInputSchemas) as ToolName[]

export type ToolInput<K extends ToolName> = z.infer<(typeof toolInputSchemas)[K]>

/** A validated, normalised action as it travels to the browser. */
export type CanvasAction = {
	[K in ToolName]: { type: K } & ToolInput<K>
}[ToolName]

export type ActionOf<K extends ToolName> = Extract<CanvasAction, { type: K }>

/** Actions that create a new object carry the id the server assigned. */
export const CREATING_TOOLS = [
	'write_text',
	'write_equation',
	'highlight',
	'draw_arrow',
	'draw_line',
	'draw_rectangle',
	'draw_circle',
	'draw_axes',
] as const satisfies readonly ToolName[]

export type Position = z.infer<typeof Position>
export type Anchor = z.infer<typeof Anchor>
export type InkColor = z.infer<typeof InkColor>
export type HighlightColor = z.infer<typeof HighlightColor>
