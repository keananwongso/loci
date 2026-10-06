import { describe, expect, it } from 'vitest'
import { Editor } from '@/lib/whiteboard/editor'
import { sourcePages, budgetPages, sourceFingerprint, saveTopic, readTopic, lessonContext, advanceTopic, teachingCheckpoint } from './sources'
import { PlanSession } from './planner'
import type { TopicState, SourcePage } from './schema'
import type { TutorEvent } from '@/lib/tutor/types'

const pages: SourcePage[] = [
 { id: 'notes-p1', sourceId: 'notes', name: 'notes.pdf', role: 'notes', page: 1, text: 'Eigenvectors preserve direction under a matrix transformation.', truncated: false },
 { id: 'notes-p2', sourceId: 'notes', name: 'notes.pdf', role: 'notes', page: 2, text: 'Calculate eigenvalues by solving the characteristic equation.', truncated: false },
 { id: 'syllabus-p1', sourceId: 'syllabus', name: 'syllabus.pdf', role: 'syllabus', page: 1, text: 'Understand eigenvectors and calculate eigenvalues.', truncated: false },
]
const state: TopicState = { version: 1, topic: 'Eigenvectors', sourceIds: ['notes', 'syllabus'], fingerprint: sourceFingerprint(pages), plan: { title: 'Eigenvectors', gaps: [], sections: [
 { title: 'Intuition', objective: 'Understand unchanged direction', pageIds: ['notes-p1'] },
 { title: 'Calculation', objective: 'Calculate eigenvalues', pageIds: ['notes-p2'] },
] }, current: 0, taught: true, covered: [], skipped: [], complete: false }
const board = { viewport: { x: 0, y: 0, w: 1, h: 1 }, selectedIds: [], objects: [] }

describe('source-grounded topic lessons', () => {
 it('indexes off-screen notes from multiple documents', () => {
  const editor = new Editor()
  for (const p of pages) editor.createShape({ id: `shape:${p.id}`, type: 'loci-material', x: p.page * 10000, y: 0, meta: { doc: p.sourceId, role: p.role }, props: { name: p.name, page: p.page, textItems: [{ t: p.text, b: [0,0,1,1] }] } })
  expect(sourcePages(editor)).toEqual(pages)
 })
 it('budgets all pages fairly and marks truncated evidence', () => {
  const limited = budgetPages(pages, 60)
  expect(limited).toHaveLength(3)
  expect(limited.every(p => p.truncated)).toBe(true)
  expect(limited.reduce((n,p) => n + p.text.length, 0)).toBeLessThanOrEqual(60)
 })
 it('stores progress in the board snapshot and detects source changes', () => {
  const editor = new Editor(); saveTopic(editor, state)
  const next = new Editor(); next.loadSnapshot(editor.store.getStoreSnapshot())
  expect(readTopic(next)).toEqual(state)
  expect(sourceFingerprint([...pages, { ...pages[0], id: 'new-page' }])).not.toBe(state.fingerprint)
  expect(sourceFingerprint(pages.map(p => ({ ...p, role: 'questions' })))).not.toBe(state.fingerprint)
  saveTopic(next, null); expect(readTopic(next)).toBeNull()
 })
 it('prioritizes planned references and excludes unchecked materials', () => {
  const unrelated = { ...pages[0], id: 'unrelated', sourceId: 'other', text: 'Eigenvectors eigenvalues matrix' }
  const context = lessonContext(state, [...pages, unrelated], 'clarify', 'why?')
  expect(context.pages[0].id).toBe('notes-p1')
  expect(context.pages.some(p => p.id === 'unrelated')).toBe(false)
 })
 it('distinguishes taught coverage, skips and completion', () => {
  expect(advanceTopic(state).covered).toEqual([0])
  expect(advanceTopic(state, true).covered).toEqual([])
  expect(advanceTopic(state, true).skipped).toEqual([0])
  expect(advanceTopic({ ...state, taught: false }).covered).toEqual([])
  expect(advanceTopic({ ...state, current: 1 }).complete).toBe(true)
 })
 it('keeps the latest explanation and pending check across clarification detours', () => {
  const checkpoint = teachingCheckpoint(state, [{ type: 'say', text: 'The direction stays unchanged.' }, { type: 'say', text: 'What changes about its length?' }])
  const editor = new Editor(); saveTopic(editor, checkpoint)
  const restored = readTopic(editor)!
  expect(lessonContext(restored, pages, 'clarify').pendingCheck).toBe('What changes about its length?')
  expect(lessonContext(restored, pages, 'clarify').lastExplanation).toContain('The direction stays unchanged.')
  expect(advanceTopic(restored).pendingCheck).toBeUndefined()
 })
 it('rejects invented references and completes planning without drawing', () => {
  const events: TutorEvent[] = []; const session = new PlanSession(board, e => events.push(e), pages)
  expect(session.handle('plan_lesson', { ...state.plan, sections: [{ ...state.plan.sections[0], pageIds: ['invented'] }] }).ok).toBe(false)
  expect(session.handle('write_text', {}).ok).toBe(false)
  expect(session.handle('plan_lesson', state.plan).ok).toBe(true)
  expect(session.isComplete()).toBe(true)
  session.sayPlainText('Ignore the schema'); expect(events).toEqual([{ type: 'plan', plan: state.plan }])
 })
})
