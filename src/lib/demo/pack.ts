/**
 * The demo pack: everything the guided first run uses, kept out of the code so it can be swapped
 * from the local admin view (/admin) without touching a line of it. It lives in public/demo/:
 *
 *   pack.json        this file's DemoPack: the materials, the spoken lines and the steps
 *   <material files> the pdfs and images placed on the board
 *   takes/<id>.json  a recorded answer: the exact stream of what the tutor said and drew
 *   voice.json       spoken line → pre-rendered mp3, so replays cost nothing
 *   voice/<hash>.mp3
 *
 * A step is something the visitor does: ask a suggested question, or answer the tutor's check
 * question. Each branch of a step is matched against what the visitor said or typed and replays
 * its recorded take, so the whole first run is deterministic and free. Takes are recorded from a
 * real model in the admin view, in step order, each on the board the earlier takes left behind.
 */
import { z } from 'zod'
import { ROLES } from '@/lib/documents/roles'
import type { TutorEvent } from '@/lib/tutor/types'

export const DEMO_DIR = '/demo'

const line = z.string().trim().max(600)

export const DemoMaterialSchema = z.object({
	/** File name inside public/demo/. */
	file: z.string().regex(/^[\w.-]+\.(pdf|png|jpe?g|webp)$/i, 'letters, digits, dots, dashes and underscores only'),
	role: z.enum(ROLES),
})
export type DemoMaterial = z.infer<typeof DemoMaterialSchema>

export const DemoBranchSchema = z.object({
	id: z.string().regex(/^[\w-]+$/),
	/**
	 * Words or phrases that pick this branch (case-insensitive, any one is enough). Empty means
	 * "anything else": put it last.
	 */
	match: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
	/** After this branch, go on to the next step, or stay on this one for another try. */
	next: z.enum(['continue', 'retry']).default('continue'),
	/** What was asked when the take was recorded; the admin uses it to re-record. */
	sample: z.string().trim().max(400).optional(),
	/** Recorded take, a path inside public/demo/. Without one, the step asks the live model. */
	take: z.string().regex(/^takes\/[\w-]+\.json$/).optional(),
})
export type DemoBranch = z.infer<typeof DemoBranchSchema>

export const DemoStepSchema = z.object({
	id: z.string().regex(/^[\w-]+$/),
	/** ask: the visitor asks a suggested question. answer: they answer the tutor's check question. */
	kind: z.enum(['ask', 'answer']),
	/** Spoken by the tutor before the step, telling the visitor what to do. */
	intro: line.optional(),
	/** ask: the suggested question shown as a chip. answer: the hint shown while it waits. */
	prompt: line.min(1),
	/** ask: the phrase on the page the visitor should point at, shown as a hint. */
	point: z.object({ file: z.string(), page: z.number().int().min(1).default(1), text: z.string().min(1).max(200) }).optional(),
	branches: z.array(DemoBranchSchema).min(1).max(8),
})
export type DemoStep = z.infer<typeof DemoStepSchema>

export const DemoPackSchema = z.object({
	version: z.literal(1),
	/** Shown on the start screen. */
	title: line.min(1),
	/** Spoken when the visitor starts. */
	greeting: line.optional(),
	/** Spoken after the last step, before the visitor is free to ask anything. */
	outro: line.optional(),
	materials: z.array(DemoMaterialSchema).min(1).max(12),
	steps: z.array(DemoStepSchema).max(20),
})
export type DemoPack = z.infer<typeof DemoPackSchema>

/** One event of a recorded take, with when it arrived (ms from the start), so replays keep the pace. */
export type TakeEvent = Extract<TutorEvent, { type: 'say' | 'thought' | 'action' | 'status' }> & { t: number }

export const TakeSchema = z.object({
	version: z.literal(1),
	question: z.string(),
	model: z.string(),
	recordedAt: z.string(),
	events: z.array(
		z
			.object({ type: z.enum(['say', 'thought', 'action', 'status']), t: z.number().min(0) })
			.loose()
	),
})
export type Take = { version: 1; question: string; model: string; recordedAt: string; events: TakeEvent[] }

const words = (s: string) =>
	` ${s
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()} `

/** The branch for what the visitor said: the first whose phrase appears in it, else the catch-all. */
export function pickBranch(step: DemoStep, said: string): DemoBranch {
	const heard = words(said)
	const hit = step.branches.find((b) => b.match.some((m) => heard.includes(words(m))))
	return hit ?? step.branches.find((b) => b.match.length === 0) ?? step.branches[step.branches.length - 1]
}

/** Every line the pack can say out loud, for pre-rendering the voice. */
export function packLines(pack: DemoPack): string[] {
	return [pack.greeting, pack.outro, ...pack.steps.map((s) => s.intro)].filter((l): l is string => Boolean(l))
}
