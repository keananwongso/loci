'use client'
import { useEffect, useRef, useState } from 'react'
import { useEditor, useValue } from '@/lib/whiteboard'
import { ROLE_LABELS } from '@/lib/documents/roles'
import { budgetPages, sourcePages, sourceFingerprint, readTopic, saveTopic, lessonContext, advanceTopic, teachingCheckpoint } from '@/lib/topics/sources'
import { TopicPlanSchema, type LessonContext, type TopicPlan, type TopicState } from '@/lib/topics/schema'
import { userKeyHeaders } from '@/lib/storage/userKey'
import { readStream, type TurnResult } from '@/lib/tutor/client'

export function TopicLesson({ busy, requestedTopic, requestKey, onPlanning, onQuota, onTeach }: {
 busy: boolean; requestedTopic: string; requestKey: number; onPlanning: (planning: boolean) => void; onQuota: (remaining: number) => void;
 onTeach: (question: string, lesson: LessonContext) => Promise<TurnResult | null>
}) {
 const editor = useEditor()
 const pagesJson = useValue('topic-sources', () => JSON.stringify(sourcePages(editor)))
 const pages = JSON.parse(pagesJson) as ReturnType<typeof sourcePages>
 const stateJson = useValue('topic-progress', () => JSON.stringify(readTopic(editor)))
 const state = JSON.parse(stateJson) as TopicState | null
 const [open, setOpen] = useState(false)
 const [editing, setEditing] = useState(false)
 const [topic, setTopic] = useState('')
 const [selected, setSelected] = useState<string[]>([])
 const [draft, setDraft] = useState<TopicPlan | null>(null)
 const [planning, setPlanning] = useState(false)
 const [error, setError] = useState('')
 const abort = useRef<AbortController | null>(null)
 const draftFingerprint = useRef('')
 const sources = [...new Map(pages.map(p => [p.sourceId, { id: p.sourceId, name: p.name, role: p.role }])).values()]
 const selectedPages = pages.filter(p => selected.includes(p.sourceId))
 const stale = Boolean(state && sourceFingerprint(pages.filter(p => state.sourceIds.includes(p.sourceId))) !== state.fingerprint)
 const sourceIds = sources.map(s => s.id).join('|')
 useEffect(() => { setSelected(sources.map(s => s.id)) }, [sourceIds]) // New material defaults to included.
 useEffect(() => {
  if (!requestKey) return
  setOpen(true); setEditing(true); setTopic(requestedTopic); setDraft(null); setError('')
 }, [requestKey, requestedTopic])
 useEffect(() => { const cancel = () => abort.current?.abort(); window.addEventListener('loci:cancel-topic-plan', cancel); return () => { cancel(); window.removeEventListener('loci:cancel-topic-plan', cancel) } }, [])

 const plan = async () => {
  if (!topic.trim() || !selectedPages.length || busy || planning) return
  if (selected.length > 50 || selectedPages.length > 800) { setError('Use up to 50 materials and 800 imported pages per lesson.'); return }
  const controller = new AbortController(); abort.current = controller
  const fingerprint = sourceFingerprint(selectedPages)
  setPlanning(true); onPlanning(true); setError(''); setDraft(null)
  try {
   const res = await fetch('/api/tutor', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', ...userKeyHeaders() }, body: JSON.stringify({
    question: `Plan a lesson on ${topic.trim()}`, planning: { topic: topic.trim(), pages: budgetPages(selectedPages) },
    board: { viewport: { x: 0, y: 0, w: 1, h: 1 }, selectedIds: [], objects: [] }, images: [], history: [], turn: 0,
   }) })
   if (!res.ok || !res.body) { const body = await res.json().catch(() => ({})); throw new Error(body.error || 'Could not plan this lesson.') }
   const quota = res.headers.get('X-Loci-Quota-Remaining'); if (quota !== null) onQuota(Number(quota))
   let found: TopicPlan | null = null
   for await (const event of readStream(res.body)) {
    if (event.type === 'plan') found = TopicPlanSchema.parse(event.plan)
    if (event.type === 'error') throw new Error(event.message)
   }
   if (controller.signal.aborted) return
   if (!found) throw new Error('No outline was returned. Try again.')
   if (sourceFingerprint(sourcePages(editor).filter(p => selected.includes(p.sourceId))) !== fingerprint) throw new Error('Your sources changed while planning. Build the outline again.')
   draftFingerprint.current = fingerprint; setDraft(found)
  } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not plan this lesson.') }
  finally { abort.current = null; setPlanning(false); onPlanning(false) }
 }
 const teach = async (next: TopicState, intent: LessonContext['intent'] = 'teach') => {
  setError(''); saveTopic(editor, next)
  const section = next.plan.sections[next.current]
  const context = lessonContext(next, pages, intent)
  if (intent === 'teach') { const first = context.pages.find(p => p.role === 'notes') || context.pages[0]; const shape = first && editor.getCurrentPageShapes().find(s => s.id === `shape:${first.id}` || s.id === first.id); if (shape) editor.select(shape.id) }
  const result = await onTeach(intent === 'practice' ? `Give me a practice problem for ${section.title}.` : intent === 'clarify' ? `Explain ${section.title} another way, with a simpler concrete example.` : `Teach me ${section.title}.`, context)
  if (result && !result.error && !result.stopped && !readTopic(editor)?.complete) {
   const current = readTopic(editor)
   if (current && current.current === next.current) saveTopic(editor, teachingCheckpoint(current, result.events, intent === 'teach'))
  }
 }
 const start = () => {
  if (!draft) return
  if (sourceFingerprint(selectedPages) !== draftFingerprint.current) { setDraft(null); setError('Your sources changed. Build the outline again.'); return }
  const checked = TopicPlanSchema.safeParse(draft)
  if (!checked.success) { setError('Give every section a title and learning objective.'); return }
  const next: TopicState = { version: 1, topic, sourceIds: selected, fingerprint: sourceFingerprint(selectedPages), plan: checked.data, current: 0, covered: [], skipped: [], taught: false, complete: false }
  setEditing(false); void teach(next)
 }
 const jump = (i: number) => {
  if (!state) return
  void teach({ ...state, current: i, complete: false, taught: false, pendingCheck: undefined, lastExplanation: undefined })
 }
 const busyNow = busy || planning
 const showSetup = editing || !state
 return <section className="loci-topic" data-open={open} onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} aria-label="Topic lesson">
  <button className="loci-topic__toggle" aria-expanded={open} aria-controls="loci-topic-panel" onClick={() => setOpen(v => !v)}>
   <span>{state ? (state.complete ? 'Review topic' : `Lesson · ${state.current + 1}/${state.plan.sections.length}`) : 'Teach me a topic'}</span><span aria-hidden>{open ? '−' : '+'}</span>
  </button>
  {open && <div id="loci-topic-panel" className="loci-topic__panel">
   {showSetup ? <>
    <h2>Learn from your materials</h2><p>Choose a topic. Loci will build a path through your notes and syllabus.</p>
    {!sources.length ? <p>Add notes, a PDF or a public link to get started.</p> : <>
     <label htmlFor="lesson-topic">What would you like to learn?</label>
     <input id="lesson-topic" value={topic} maxLength={400} placeholder="e.g. Eigenvectors from chapter 3" disabled={busyNow} onChange={e => { setTopic(e.target.value); setDraft(null) }} />
     <fieldset disabled={busyNow}><legend>Using {selected.length} material{selected.length === 1 ? '' : 's'}</legend>
      {sources.map(s => <label className="loci-topic__source" key={s.id}><input type="checkbox" checked={selected.includes(s.id)} onChange={e => { setSelected(ids => e.target.checked ? [...ids, s.id] : ids.filter(id => id !== s.id)); setDraft(null) }} /><span>{s.name}<small>{ROLE_LABELS[s.role]}</small></span></label>)}
     </fieldset>
     {selectedPages.some(p => !p.text.trim()) && <p className="loci-topic__notice">Some pages have no readable text. Add a text-based PDF for a reliable outline; images can still be used during teaching.</p>}
     {!draft && <button className="loci-primary" disabled={busyNow || !topic.trim() || !selectedPages.length} onClick={() => void plan()}>{planning ? 'Building your outline…' : 'Build lesson outline'}</button>}
     {planning && <button onClick={() => abort.current?.abort()}>Cancel planning</button>}
     {draft && <>
      <h3>Your lesson outline</h3>
      <ol className="loci-topic__draft">{draft.sections.map((section, i) => <li key={i}>
       <label className="loci-sr-only" htmlFor={`lesson-section-${i}`}>Section {i + 1} title</label>
       <input id={`lesson-section-${i}`} value={section.title} maxLength={160} disabled={busyNow} onChange={e => setDraft({ ...draft, sections: draft.sections.map((s, j) => i === j ? { ...s, title: e.target.value } : s) })} />
       <label className="loci-sr-only" htmlFor={`lesson-objective-${i}`}>Section {i + 1} objective</label>
       <textarea id={`lesson-objective-${i}`} value={section.objective} maxLength={600} disabled={busyNow} onChange={e => setDraft({ ...draft, sections: draft.sections.map((s, j) => i === j ? { ...s, objective: e.target.value } : s) })} />
       <div><button disabled={busyNow || i === 0} onClick={() => { const all = [...draft.sections]; [all[i-1], all[i]] = [all[i], all[i-1]]; setDraft({ ...draft, sections: all }) }}>Move up</button><button disabled={busyNow || draft.sections.length === 1} onClick={() => setDraft({ ...draft, sections: draft.sections.filter((_, j) => i !== j) })}>Remove</button></div>
      </li>)}</ol>
      {draft.gaps.length > 0 && <div className="loci-topic__notice"><strong>Source gaps</strong><ul>{draft.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul></div>}
      <button className="loci-primary" disabled={busyNow} onClick={start}>Start learning</button><button disabled={busyNow} onClick={() => void plan()}>Rebuild outline</button>
     </>}
     <small className="loci-topic__cost">Building an outline and each teaching turn use one question from your allowance when hosted limits apply.</small>
    </>}
    {state && <button disabled={busyNow} onClick={() => setEditing(false)}>Back to current lesson</button>}
   </> : <>
    <h2>{state.plan.title}</h2>
    <p>{state.complete ? `${state.covered.length} of ${state.plan.sections.length} sections covered${state.skipped.length ? `; ${state.skipped.length} skipped` : ''}. Revisit any section below.` : 'Ask questions at any time. Your place is saved with this board.'}</p>
    {stale && <p className="loci-topic__notice">Your lesson sources changed or were removed. Rebuild the outline before continuing.</p>}
    <ol className="loci-topic__outline">{state.plan.sections.map((s, i) => <li key={i}><button aria-current={!state.complete && i === state.current ? 'step' : undefined} disabled={busyNow || stale} onClick={() => jump(i)}><span aria-hidden>{state.covered.includes(i) ? '✓' : state.skipped.includes(i) ? '↷' : i + 1}</span>{s.title}</button></li>)}</ol>
    <p className="loci-topic__objective">{state.plan.sections[state.current].objective}</p>
    <details><summary>Sources for this section</summary>{lessonContext(state, pages, 'teach').pages.map(p => <button className="loci-topic__citation" key={p.id} onClick={() => {
     const shape = editor.getCurrentPageShapes().find(s => s.id === `shape:${p.id}` || s.id === p.id)
     if (shape) { editor.select(shape.id); const b = editor.getShapePageBounds(shape); if (b) editor.zoomToBounds(b, { inset: 100 }) }
    }}>{p.name} · p. {p.page}</button>)}</details>
    {state.plan.gaps.length > 0 && <details className="loci-topic__notice"><summary>Source gaps</summary><ul>{state.plan.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul></details>}
    {!state.complete && <div className="loci-topic__actions">
     <button className="loci-primary" disabled={busyNow || stale} onClick={() => {
      if (!state.taught) { void teach(state); return }
      const next = advanceTopic(state)
      if (next.complete) saveTopic(editor, next); else void teach(next)
     }}>{state.taught ? (state.current === state.plan.sections.length - 1 ? 'Finish topic' : 'Continue') : 'Resume section'}</button>
     <button disabled={busyNow || stale} onClick={() => void teach(state, 'clarify')}>Explain another way</button>
     <button disabled={busyNow || stale} onClick={() => void teach(state, 'practice')}>Try a problem</button>
     <button disabled={busyNow || stale} onClick={() => { const next = advanceTopic(state, true); if (next.complete) saveTopic(editor, next); else void teach(next) }}>Skip section</button>
    </div>}
    <button disabled={busyNow} onClick={() => { setTopic(state.topic); setSelected(state.sourceIds); setDraft(null); setEditing(true) }}>{stale ? 'Rebuild lesson' : 'New topic'}</button>
   </>}
   {error && <p role="alert" className="loci-topic__notice">{error}</p>}
  </div>}
 </section>
}
