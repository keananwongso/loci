'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Turn } from '@/lib/storage/conversation'
import { renderRich } from '@/lib/canvas/richtext'
import { CloseIcon, HistoryIcon, UndoIcon } from './icons'
import type { TutorStatus } from '../useTutor'
import { REPO_URL } from './KeyDialog'

const PHASE: Record<Turn['status'], string> = {
	looking: 'Looking at your board',
	thinking: 'Thinking',
	teaching: 'Teaching',
	done: '',
	error: 'Something went wrong',
	stopped: 'Stopped',
}

function TurnView({ turn, live, accounts, onReplay }: { turn: Turn; live: boolean; accounts?: boolean; onReplay: (turn: Turn) => void }) {
	return (
		<article className="loci-turn" data-live={live}>
			{!live && turn.lessonId && <button className="loci-chip-btn" onClick={() => onReplay(turn)}>▶ Replay explanation</button>}
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
			{turn.limitReached && (
				<div className="loci-turn__limit">
					{accounts && <a className="loci-chip-btn" href="/account">View account / Loci Pro</a>}
					<button className="loci-chip-btn" onClick={() => window.dispatchEvent(new CustomEvent('loci:open-key-dialog'))}>
						Use your own API key
					</button>
					<a className="loci-chip-btn" href={REPO_URL} target="_blank" rel="noreferrer">
						★ Star on GitHub
					</a>
					<a className="loci-chip-btn" href={`${REPO_URL}#local-setup`} target="_blank" rel="noreferrer">
						Run it locally (free, open source)
					</a>
				</div>
			)}
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
	onReplay: (turn: Turn) => void
	/** In voice mode the orb's captions carry the answer, so the text panel starts collapsed. */
	voice?: boolean
}

export function ResponsePanel({ turns, busy, status, onUndo, onReplay, voice }: Props) {
	const [open, setOpen] = useState(!voice)
	const [history, setHistory] = useState(false)
	const bodyRef = useRef<HTMLDivElement>(null)
	const last = turns.at(-1)
	const shown = useMemo(() => (history ? turns : last ? [last] : []), [history, turns, last])

	useEffect(() => {
		if (busy) setOpen(!voice)
	}, [busy, turns.length, voice])

	useEffect(() => {
		setOpen(!voice)
	}, [voice])

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
		const line = last.said.at(-1)
		return <div className="loci-captions">
			{line && <p key={line} className="loci-caption" aria-live="polite">{line}</p>}
			<div className="loci-caption-actions"><button className="loci-chip-btn" onClick={() => setOpen(true)}>Show transcript</button>{!busy && last.lessonId && <button className="loci-chip-btn" onClick={() => onReplay(last)}>▶ Replay</button>}</div>
		</div>
	}

	const phase = last.limitReached === 'store' ? 'Loci temporarily unavailable' : last.limitReached === 'subscription' ? 'Monthly questions used up' : last.limitReached === 'daily' ? 'Daily questions used up' : last.limitReached === 'global' && status.pro ? 'Loci at capacity today' : last.limitReached ? 'Free questions used up' : PHASE[last.status]
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
					<TurnView key={t.id} turn={t} live={busy || (t.id === last.id && live)} accounts={status.accounts} onReplay={onReplay} />
				))}
				{live && last.said.length === 0 && (
					<p className="loci-turn__placeholder">{last.status === 'looking' ? 'Reading the page you selected…' : 'Working out how to explain this…'}</p>
				)}
			</div>
		</section>
	)
}
