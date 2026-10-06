import { z } from 'zod'
import { ROLES } from '@/lib/documents/roles'

export const SourcePageSchema = z.object({
 id: z.string().min(1).max(80), sourceId: z.string().min(1).max(120), name: z.string().max(300),
 role: z.enum(ROLES), page: z.number().int().positive(), text: z.string().max(12000),
 truncated: z.boolean(),
})
export const SourcePagesSchema = z.array(SourcePageSchema).min(1).max(800).refine(
 pages => pages.reduce((n, p) => n + p.text.length, 0) <= 120000, 'Source context is too large.',
)
export const LessonSectionSchema = z.object({
 title: z.string().trim().min(1).max(160), objective: z.string().trim().min(1).max(600),
 pageIds: z.array(z.string().min(1).max(80)).max(12),
})
export const TopicPlanSchema = z.object({
 title: z.string().trim().min(1).max(160), sections: z.array(LessonSectionSchema).min(1).max(16),
 gaps: z.array(z.string().max(500)).max(16),
})
export const LessonContextSchema = z.object({
 title: z.string().max(160), outline: z.array(z.string().max(160)).max(16),
 current: z.number().int().min(0).max(15), objective: z.string().max(600),
 intent: z.enum(['teach', 'clarify', 'practice']), pages: SourcePagesSchema,
 pendingCheck: z.string().max(1000).optional(), lastExplanation: z.string().max(6000).optional(),
})
export const TopicStateSchema = z.object({
 version: z.literal(1), topic: z.string().max(400), sourceIds: z.array(z.string().max(120)).min(1).max(50),
 fingerprint: z.string().max(32), plan: TopicPlanSchema, current: z.number().int().min(0).max(15),
 covered: z.array(z.number().int().min(0).max(15)).max(16), skipped: z.array(z.number().int().min(0).max(15)).max(16),
 taught: z.boolean(), complete: z.boolean(),
 pendingCheck: z.string().max(1000).optional(), lastExplanation: z.string().max(6000).optional(),
}).refine(s => s.current < s.plan.sections.length, 'Invalid lesson position.')
export type SourcePage = z.infer<typeof SourcePageSchema>
export type TopicPlan = z.infer<typeof TopicPlanSchema>
export type TopicState = z.infer<typeof TopicStateSchema>
export type LessonContext = z.infer<typeof LessonContextSchema>
