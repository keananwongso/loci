import type { Editor } from '@/lib/whiteboard'
import { MATERIAL, type MaterialShape } from '@/lib/canvas/shape-types'
import { roleOf } from '@/lib/documents/roles'
import { groupLines } from '@/lib/documents/text'
import { toModelId } from '@/lib/canvas/executor'
import type { LessonContext, SourcePage, TopicPlan, TopicState } from './schema'
import { TopicStateSchema } from './schema'

const pageTexts = new WeakMap<MaterialShape['props']['textItems'], string>()
function pageText(items: MaterialShape['props']['textItems']) {
 let text = pageTexts.get(items)
 if (text === undefined) { text = groupLines(items).map(l => l.text).join('\n'); pageTexts.set(items, text) }
 return text
}
export const TOPIC_RECORD = 'loci:topic-lesson'
/** Indexed independently of the viewport; original text and positioned boxes stay on the board. */
export function sourcePages(editor: Editor): SourcePage[] {
 return editor.getCurrentPageShapes().filter((s): s is MaterialShape => s.type === MATERIAL).map(s => ({
  id: toModelId(s.id), sourceId: String(s.meta.doc || s.id), name: s.props.name.slice(0, 300),
  role: roleOf(s.meta), page: s.props.page,
  text: pageText(s.props.textItems), truncated: false,
 })).sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.page - b.page)
}
/** Allocate a fair share to every page, rather than silently dropping later source documents. */
export function budgetPages(pages: SourcePage[], total = 120000): SourcePage[] {
 const cap = Math.min(12000, Math.floor(total / Math.max(1, pages.length)))
 return pages.map(p => ({ ...p, text: p.text.slice(0, cap), truncated: p.truncated || p.text.length > cap }))
}
export function sourceFingerprint(pages: SourcePage[]): string {
 let h = 2166136261
 for (const p of pages) { const value = JSON.stringify([p.id, p.sourceId, p.name, p.page, p.role, p.text]); for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619) }
 return (h >>> 0).toString(16)
}
export function readTopic(editor: Editor): TopicState | null {
 const raw = editor.store.getStoreSnapshot().store[TOPIC_RECORD]?.lesson
 const parsed = TopicStateSchema.safeParse(raw)
 return parsed.success ? parsed.data : null
}
/** Nonvisual document record: local persistence and existing account sync both include it. */
export function saveTopic(editor: Editor, state: TopicState | null) {
 editor.run(() => {
  if (state) editor.store.put([{ id: TOPIC_RECORD, typeName: 'loci-topic', lesson: state }])
  else editor.store.remove([TOPIC_RECORD])
 }, { history: 'ignore' })
}
const tokens = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])
/** References selected by the planner win; lexical retrieval also helps follow-up detours. */
export function lessonContext(state: TopicState, pages: SourcePage[], intent: LessonContext['intent'], question = ''): LessonContext {
 const section = state.plan.sections[state.current]
 const wanted = new Set(section.pageIds)
 const words = tokens(`${state.plan.title} ${section.title} ${section.objective} ${question}`)
 const selected = pages.filter(p => state.sourceIds.includes(p.sourceId))
 const ranked = selected.map(p => ({ p, score: (wanted.has(p.id) ? 10000 : 0) + [...words].filter(w => p.text.toLowerCase().includes(w)).length + (p.role === 'syllabus' ? 2 : 0) }))
  .sort((a, b) => b.score - a.score)
 const relevant = ranked.slice(0, 12).map(x => x.p)
 return { title: state.plan.title, outline: state.plan.sections.map(s => s.title), current: state.current, objective: section.objective, intent, pages: budgetPages(relevant, 24000), ...(intent !== 'teach' ? { pendingCheck: state.pendingCheck, lastExplanation: state.lastExplanation } : {}) }
}
export function validPlanReferences(plan: TopicPlan, pages: SourcePage[]): boolean {
 const ids = new Set(pages.map(p => p.id))
 return plan.sections.every(s => s.pageIds.every(id => ids.has(id)))
}
/** Advancing records coverage only after a successful teaching turn, never on skip. */
export function advanceTopic(state: TopicState, skip = false): TopicState {
 const covered = !skip && state.taught ? [...new Set([...state.covered, state.current])] : state.covered
 const skipped = skip ? [...new Set([...state.skipped, state.current])] : state.skipped.filter(i => i !== state.current)
 const last = state.current === state.plan.sections.length - 1
 return { ...state, covered, skipped, current: last ? state.current : state.current + 1, taught: false, complete: last, pendingCheck: undefined, lastExplanation: undefined }
}

export function teachingCheckpoint(state: TopicState, events: import('@/lib/tutor/types').TutorEvent[], taught = true): TopicState {
 const said = events.filter((e): e is Extract<import('@/lib/tutor/types').TutorEvent, { type: 'say' }> => e.type === 'say').map(e => e.text)
 const last = said.at(-1)
 return { ...state, taught: taught || state.taught, lastExplanation: said.join(' ').slice(0, 6000), pendingCheck: last?.trim().endsWith('?') ? last.slice(0, 1000) : state.pendingCheck }
}
