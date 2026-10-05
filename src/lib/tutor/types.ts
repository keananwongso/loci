/**
 * Types shared by the browser and the local server route. Requests are validated with
 * these Zod schemas on the server before anything is sent to a model provider.
 */
import { z } from 'zod'
import { GraphItem, type Anchor, type CanvasAction } from '@/lib/actions/schema'
import { ROLES } from '@/lib/documents/roles'

const num = z.number().finite()
export const BoxSchema = z.object({ x: num, y: num, w: num, h: num })
export type Box = z.infer<typeof BoxSchema>

/** A run of text extracted from a pdf page; `b` is [x, y, w, h] normalised to the page. */
export const TextItemSchema = z.object({ t: z.string().max(2000), b: z.tuple([num, num, num, num]) })
export type TextItem = z.infer<typeof TextItemSchema>

export const ObjectTypeSchema = z.enum([
	'pdf',
	'image',
	'text',
	'equation',
	'graph',
	'highlight',
	'arrow',
	'line',
	'rectangle',
	'ellipse',
	'shape',
	'drawing',
	'note',
	'region',
	'other',
])
export type BoardObjectType = z.infer<typeof ObjectTypeSchema>

export const BoardObjectSchema = z.object({
	id: z.string().max(80),
	type: ObjectTypeSchema,
	author: z.enum(['user', 'assistant']),
	bounds: BoxSchema,
	parentId: z.string().max(80).optional(),
	turn: z.number().int().optional(),
	text: z.string().max(4000).optional(),
	latex: z.string().max(1000).optional(),
	label: z.string().max(400).optional(),
	material: z
		.object({
			kind: z.enum(['pdf', 'image']),
			name: z.string().max(300),
			role: z.enum(ROLES).optional(),
			page: z.number().int().optional(),
			pageCount: z.number().int().optional(),
			pixelSize: z.tuple([num, num]).optional(),
			/** Full text items: only for the materials in focus. */
			textItems: z.array(TextItemSchema).max(6000).optional(),
			/** Short preview for materials out of focus. */
			textPreview: z.string().max(1200).optional(),
			/** Full text of a syllabus or mark scheme page out of focus, for the tutor to consult. */
			referenceText: z.string().max(6000).optional(),
		})
		.optional(),
	graph: z
		.object({
			xRange: z.tuple([num, num]),
			yRange: z.tuple([num, num]),
			title: z.string().max(200).optional(),
			items: z.array(GraphItem).max(200),
		})
		.optional(),
	highlight: z.object({ style: z.string().max(20), region: BoxSchema.optional() }).optional(),
	connector: z
		.object({
			from: z.string().max(80).optional(),
			to: z.string().max(80).optional(),
		})
		.optional(),
})
export type BoardObject = z.infer<typeof BoardObjectSchema>

export const BoardContextSchema = z.object({
	viewport: BoxSchema,
	selectedIds: z.array(z.string().max(80)).max(200),
	/** A region the student dragged out with the "Ask about an area" tool. */
	region: z
		.object({
			id: z.string().max(80),
			bounds: BoxSchema,
			materialId: z.string().max(80).optional(),
			/** The region in the material's normalised coordinates. */
			normalized: BoxSchema.optional(),
			text: z.string().max(4000).optional(),
		})
		.optional(),
	objects: z.array(BoardObjectSchema).max(600),
	/** The material the question is about (selected, under the region, or most in view), first is likeliest. */
	focusIds: z.array(z.string().max(80)).max(10).optional(),
})
export type BoardContext = z.infer<typeof BoardContextSchema>

export const ContextImageSchema = z.object({
	label: z.string().max(300),
	mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
	/** base64 without the data: prefix */
	data: z.string().max(7_000_000),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
})
export type ContextImage = z.infer<typeof ContextImageSchema>

export const HistoryTurnSchema = z.object({
	question: z.string().max(4000),
	answer: z.string().max(12000),
	actions: z.array(z.string().max(400)).max(80),
})
export type HistoryTurn = z.infer<typeof HistoryTurnSchema>

export const TutorRequestSchema = z.object({
	guidedDemo: z.boolean().optional(),
	question: z.string().min(1).max(4000),
	board: BoardContextSchema,
	images: z.array(ContextImageSchema).max(4),
	history: z.array(HistoryTurnSchema).max(30),
	turn: z.number().int().min(0),
})
export type TutorRequest = z.infer<typeof TutorRequestSchema>

/** Streamed from the server route to the browser as newline-delimited JSON. */
export type TutorEvent =
	/** `look`: what the sentence is about, so the tutor looks there while it speaks. */
	| { type: 'say'; text: string; look?: Anchor }
	/** What the tutor is doing right now, read from the call it is still writing. Shown while it thinks. */
	| { type: 'thought'; text: string; latex?: string }
	| { type: 'action'; action: CanvasAction; summary: string }
	| { type: 'status'; message: string }
	| { type: 'rejected'; tool: string; reason: string }
	| { type: 'error'; message: string }
	| { type: 'done' }
