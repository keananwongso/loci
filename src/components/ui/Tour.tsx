'use client'
import { useValue } from '@/lib/whiteboard'
import { heard, talkKeysLabel } from '@/lib/canvas/presence'
import { spokenScriptWords } from '@/lib/voice/read-along'
import { CloseIcon, MicIcon } from './icons'
import { REPO_URL } from './KeyDialog'
import type { useTour } from '../useTour'

type Tour = ReturnType<typeof useTour>

/** Local record mode can still start from the board. */
export function TourStart({ tour }: { tour: Tour; overBoard: boolean }) {
	if (tour.phase !== 'start') return null
	return (
		<div className="loci-coach loci-coach--floating">
			<h2>See how Loci works</h2>
			<p>Ask a question about the notes and watch Loci explain it live.</p>
			<div className="loci-coach__ask">
				<button className="loci-primary" onClick={tour.begin}>
					Let’s try it
				</button>
				<a className="loci-secondary" href="/">
					Back
				</a>
			</div>
		</div>
	)
}

export function TourCoach({ tour, busy, listening, transcribing, sending }: { tour: Tour; busy: boolean; listening: boolean; transcribing: boolean; sending: boolean }) {
	const { step } = tour
	const transcript = useValue('tour-live-transcript', () => heard.get(), [])
	if (tour.phase !== 'running' || tour.coachDismissed || !step || busy || sending) return null
	const reading = listening || transcribing
	const spoken = spokenScriptWords(step.prompt, reading ? transcript : '')
	const words = step.prompt.split(/\s+/)
	return (
		<>
			<div className="loci-coach-backdrop" aria-hidden="true" />
			<section
				className="loci-coach loci-coach--floating loci-coach--question"
				aria-label="Ask your first question"
				onPointerDown={(e) => e.stopPropagation()}
			>
				<div className="loci-coach__head">
					<h2>Hold <kbd title={talkKeysLabel() === '⌃ + ⌥' ? 'Control + Option' : talkKeysLabel()}>{talkKeysLabel()}</kbd> to talk</h2>
					<button className="loci-coach__skip" onClick={tour.skip}>
						Skip
					</button>
				</div>
				<p className="loci-coach__say-label">Then say this aloud:</p>
				<blockquote data-reading={reading} aria-label={`Say: ${step.prompt}`}>
					“{words.map((word, index) => (
						<span key={index} className="loci-coach__word" data-spoken={spoken.has(index)}>{word}{index < words.length - 1 ? ' ' : ''}</span>
					))}”
				</blockquote>
				<div className="loci-coach__instruction" role="status" aria-live="polite" data-listening={listening}>
					<MicIcon />
					{listening ? (
						<span>
							<strong>Listening</strong> · release to send
						</span>
					) : transcribing ? (
						<span>Transcribing…</span>
					) : (
						<span>
							Release the keys when you’re done.
						</span>
					)}
				</div>
				<button className="loci-coach__type" onClick={() => window.dispatchEvent(new CustomEvent('loci:prefill-prompt', { detail: step.prompt }))}>
					Type instead →
				</button>
			</section>
		</>
	)
}

export function TourEnd({ tour, busy, freeLeft, onOwnProblem }: { tour: Tour; busy: boolean; freeLeft?: number; onOwnProblem: () => void }) {
	if (tour.phase !== 'finished' || busy) return null
	const empty = freeLeft === 0
	return (
		<section className="loci-coach loci-coach--floating" aria-label="Try your own problem" onPointerDown={(e) => e.stopPropagation()}>
			<div className="loci-coach__head">
				<span className="loci-landing__eyebrow">{empty ? 'Keep learning with Loci' : 'Your turn, your problem'}</span>
				<button className="loci-coach__skip" onClick={tour.close} aria-label="Close">
					<CloseIcon />
				</button>
			</div>
			<h2>{empty ? 'Take Loci home.' : 'What are you working on?'}</h2>
			<p>
				{empty
					? 'You’ve used today’s free questions. Run Loci locally to keep learning with your own notes.'
					: 'Paste a problem or a screenshot onto the whiteboard, or keep asking about these notes.'}
			</p>
			{freeLeft !== undefined && (
				<p className="loci-landing__fine">
					{freeLeft} free question{freeLeft === 1 ? '' : 's'} left today. The first answer counts too.
				</p>
			)}
			<div className="loci-coach__ask">
				{!empty && (
					<>
						<button
							className="loci-primary loci-primary--sm"
							onClick={() => {
								tour.close()
								onOwnProblem()
							}}
						>
							Try my own problem
						</button>
						<button
							className="loci-secondary loci-secondary--sm"
							onClick={() => {
								tour.close()
								window.dispatchEvent(new Event('loci:focus-prompt'))
							}}
						>
							Keep exploring
						</button>
					</>
				)}
				<a className={empty ? 'loci-primary loci-primary--sm' : 'loci-coach__github'} href={REPO_URL} target="_blank" rel="noreferrer">
					★ Star on GitHub
				</a>
				{empty && (
					<a className="loci-secondary loci-secondary--sm" href={`${REPO_URL}#local-setup`} target="_blank" rel="noreferrer">
						Run locally ↗
					</a>
				)}
			</div>
		</section>
	)
}

const adminFetch = (path: string, init: RequestInit = {}) =>
	fetch(path, { ...init, headers: { ...(init.headers ?? {}), 'x-loci-admin': '1', 'Content-Type': 'application/json' } })

/**
 * Record mode (local admin, /demo?record): ask each step's branches against the live model and keep the
 * answers you like as takes. Keeping a "continue" branch moves on to the next step.
 */
export function TourRecord({ tour, busy, model, onRedo }: { tour: Tour; busy: boolean; model?: string; onRedo: () => void }) {
	const { pack, step, index, recorded } = tour
	if (tour.phase !== 'running' || !pack || !step || busy) return null

	const keep = async () => {
		if (!recorded) return
		const take = {
			version: 1,
			question: recorded.question,
			model: recorded.result.model ?? model ?? 'unknown',
			recordedAt: new Date().toISOString(),
			events: recorded.result.events,
		}
		const res = await adminFetch('/api/admin/take', {
			method: 'POST',
			body: JSON.stringify({ step: recorded.step.id, branch: recorded.branch.id, take }),
		})
		const body = await res.json().catch(() => ({}))
		if (!res.ok) return alert(body.error ?? 'Could not keep the take.')
		tour.setPack(body.pack)
		if (recorded.branch.next === 'continue') tour.nextStep()
		else tour.setRecorded(null)
	}

	return (
		<div className="loci-coach loci-coach--record" onPointerDown={(e) => e.stopPropagation()}>
			<div className="loci-coach__head">
				<span className="loci-coach__count">
					REC {index + 1}/{pack.steps.length}
				</span>
				<p className="loci-coach__line">
					<strong>{step.id}</strong> · {step.kind === 'ask' ? 'ask' : 'answer'} · {model ?? 'model'}
				</p>
				<a className="loci-coach__skip" href="/admin">
					Admin
				</a>
			</div>
			{recorded ? (
				<div className="loci-coach__ask">
					<span className="loci-coach__or">
						Answer for branch <strong>{recorded.branch.id}</strong> ({recorded.result.events.length} events)
					</span>
					<button className="loci-primary loci-primary--sm" onClick={keep}>
						Keep as take
					</button>
					<button
						className="loci-secondary loci-secondary--sm"
						onClick={() => {
							onRedo()
							tour.setRecorded(null)
						}}
					>
						Redo
					</button>
				</div>
			) : (
				<div className="loci-coach__ask">
					{step.branches.map((b) => (
						<button
							key={b.id}
							className="loci-suggest__chip"
							title={b.match.length ? `Matches: ${b.match.join(', ')}` : 'Anything else'}
							onClick={() => tour.ask(step.kind === 'ask' ? step.prompt : (b.sample ?? b.id), {}, b)}
						>
							<span className="loci-suggest__tag">{b.id}</span>
							{step.kind === 'ask' ? step.prompt : (b.sample ?? 'Type an answer below')}
							{b.take && <span className="loci-suggest__tag">recorded</span>}
						</button>
					))}
				</div>
			)}
			<div className="loci-coach__ask">
				<button className="loci-coach__skip" onClick={tour.nextStep}>
					Next step →
				</button>
			</div>
		</div>
	)
}
