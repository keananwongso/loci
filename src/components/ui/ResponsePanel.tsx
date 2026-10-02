'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Turn } from '@/lib/storage/conversation'
import { renderRich } from '@/lib/canvas/richtext'
import { CloseIcon, HistoryIcon, UndoIcon } from './icons'
import type { TutorStatus } from '../useTutor'

const PHASE: Record<Turn['status'], string> = {
	looking: 'Looking at your board',
	thinking: 'Thinking',
	teaching: 'Teaching',
	done: '',
	error: 'Something went wrong',
	stopped: 'Stopped',
}

function TurnView({ turn, live }: { turn: Turn; live: boolean }) {
	return (
		<article className="loci-turn" data-live={live}>
			<div className="loci-turn__q">
				<span className="loci-turn__ctx">{turn.context}</span>
				{turn.question}
			</div>
			{turn.said.map((s, i) => (
				<p key={i} className="loci-turn__said" dangerouslySetInnerHTML={{ __html: renderRich(s) }} />
			))}
			{turn.notices?.map((n, i) => (
				<p key={`n${i}`} className="loci-turn__notice">
					{n}
				</p>
			))}
			{turn.error && <p className="loci-turn__error">{turn.error}</p>}
			{!live && turn.actions.length > 0 && (
				<p className="loci-turn__meta">
					{turn.undone ? 'Drawing removed' : `${turn.actions.length} mark${turn.actions.length === 1 ? '' : 's'} on the board`}
				</p>
			)}
		</article>
	)
}

interface Props {
	turns: Turn[]
	busy: boolean
	status: TutorStatus
	onUndo: () => void
}

export function ResponsePanel({ turns, busy, status, onUndo }: Props) {
	const [open, setOpen] = useState(true)
	const [history, setHistory] = useState(false)
	const bodyRef = useRef<HTMLDivElement>(null)
	const last = turns.at(-1)
	const shown = useMemo(() => (history ? turns : last ? [last] : []), [history, turns, last])

	useEffect(() => {
		if (busy) setOpen(true)
	}, [busy, turns.length])

	useEffect(() => {
		const el = bodyRef.current
		if (el) el.scrollTop = el.scrollHeight
	}, [shown, last?.said.length])

	if (status.checked && !status.configured) {
		return (
			<div className="loci-panel loci-panel--setup" onPointerDown={(e) => e.stopPropagation()}>
				<strong>Connect a model to start tutoring.</strong>
				<span>{status.setupHint || 'Add ANTHROPIC_API_KEY to .env.local and restart the dev server.'}</span>
				<span className="loci-panel__fine">The canvas works without it: upload, annotate and arrange your notes.</span>
			</div>
		)
	}
	if (!last) return null
	if (!open) {
		return (
			<button className="loci-panel-pill" onClick={() => setOpen(true)} onPointerDown={(e) => e.stopPropagation()}>
				<span className="loci-dot" data-busy={busy} /> Show Loci&rsquo;s answer
			</button>
		)
	}

	const phase = PHASE[last.status]
	const live = ['looking', 'thinking', 'teaching'].includes(last.status)
	return (
		<section className="loci-panel" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()} aria-live="polite">
			<header className="loci-panel__head">
				<span className="loci-dot" data-busy={busy} />
				<span className="loci-panel__title">{phase || 'Loci'}</span>
				{live && <span className="loci-ellipsis" aria-hidden />}
				<div className="loci-panel__actions">
					{!busy && last.status === 'done' && last.actions.length > 0 && !last.undone && (
						<button className="loci-chip-btn" onClick={onUndo} title="Remove what Loci drew for this answer">
							<UndoIcon /> Undo drawing
						</button>
					)}
					{turns.length > 1 && (
						<button className="loci-icon-btn loci-icon-btn--sm" data-active={history} onClick={() => setHistory((h) => !h)} title="Conversation history">
							<HistoryIcon />
						</button>
					)}
					<button className="loci-icon-btn loci-icon-btn--sm" onClick={() => setOpen(false)} title="Hide">
						<CloseIcon />
					</button>
				</div>
			</header>
			<div className="loci-panel__body" ref={bodyRef}>
				{shown.map((t) => (
					<TurnView key={t.id} turn={t} live={t.id === last.id && live} />
				))}
				{live && last.said.length === 0 && (
					<p className="loci-turn__placeholder">{last.status === 'looking' ? 'Reading the page you selected…' : 'Working out how to explain this…'}</p>
				)}
			</div>
		</section>
	)
}
