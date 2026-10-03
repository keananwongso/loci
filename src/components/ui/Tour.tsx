'use client'
import { talkKeysLabel } from '@/lib/canvas/presence'
import { ROLE_LABELS } from '@/lib/documents/roles'
import type { DemoPack } from '@/lib/demo/pack'
import { CloseIcon } from './icons'
import { REPO_URL } from './KeyDialog'
import type { useTour } from '../useTour'

type Tour = ReturnType<typeof useTour>

/** The first thing a visitor sees: what Loci is, what is about to happen, and one button. */
export function TourStart({ tour, overBoard }: { tour: Tour; overBoard: boolean }) {
	const pack = tour.pack
	if (tour.phase !== 'start' || !pack) return null
	return (
		<div className="loci-empty loci-tour-start" data-over-board={overBoard || undefined}>
			<div className="loci-empty__inner" onPointerDown={(e) => e.stopPropagation()}>
				<div className="loci-sphere" aria-hidden />
				<span className="loci-badge">Open source · runs on your own machine</span>
				<h1 className="loci-empty__title">
					Learn right
					<br />
					on the page.
				</h1>
				<p className="loci-empty__lede">
					Loci is a tutor that explains by drawing beside your notes. Try a short lesson on <mark>{pack.title.toLowerCase()}</mark>: point at
					something, ask out loud, and watch it teach.
				</p>
				<MaterialList pack={pack} />
				<div className="loci-empty__actions">
					<button className="loci-primary" onClick={tour.begin}>
						Start the lesson
					</button>
					<button className="loci-secondary" onClick={tour.skip}>
						Skip
					</button>
				</div>
				<p className="loci-empty__fine">Turn your sound on. About two minutes.</p>
			</div>
		</div>
	)
}

function MaterialList({ pack }: { pack: DemoPack }) {
	const roles = [...new Set(pack.materials.map((m) => m.role))]
	return (
		<div className="loci-tour-start__roles" aria-label="On the board">
			{roles.map((r) => (
				<span key={r} className="loci-role" data-role={r}>
					{ROLE_LABELS[r]}
				</span>
			))}
		</div>
	)
}

/** While the tour runs: what to do now, the suggested question, and how to ask it. */
export function TourCoach({ tour, busy }: { tour: Tour; busy: boolean }) {
	const { pack, step, index } = tour
	if (tour.phase !== 'running' || !pack || !step || busy) return null
	const keys = talkKeysLabel()
	return (
		<div className="loci-coach" onPointerDown={(e) => e.stopPropagation()}>
			<div className="loci-coach__head">
				<span className="loci-coach__count">
					{index + 1} of {pack.steps.length}
				</span>
				{tour.line && <p className="loci-coach__line">{tour.line}</p>}
				<button className="loci-coach__skip" onClick={tour.skip} title="Skip the lesson">
					Skip
				</button>
			</div>
			{step.kind === 'ask' ? (
				<div className="loci-coach__ask">
					<button className="loci-suggest__chip" onClick={() => tour.ask(step.prompt)} onPointerEnter={tour.pointAgain}>
						{step.prompt}
					</button>
					<span className="loci-coach__or">
						or hold <kbd>{keys}</kbd>, drag over it and ask
					</span>
				</div>
			) : (
				<p className="loci-coach__hint">
					{step.prompt}. Hold <kbd>{keys}</kbd> to say it, or type below.
				</p>
			)}
		</div>
	)
}

/** After the lesson: what was real, what's next, and where the code is. */
export function TourEnd({ tour, busy, freeLeft }: { tour: Tour; busy: boolean; freeLeft?: number }) {
	if (tour.phase !== 'finished' || busy || tour.speaking) return null
	return (
		<div className="loci-coach loci-coach--end" onPointerDown={(e) => e.stopPropagation()}>
			<div className="loci-coach__head">
				<p className="loci-coach__line">
					{tour.replayed && 'That lesson was recorded, so it plays the same for everyone. '}
					{freeLeft !== undefined
						? `Ask your own question about these notes (${freeLeft} free today), or run Loci on your own notes.`
						: 'Now ask your own question about these notes.'}
				</p>
				<button className="loci-coach__skip" onClick={tour.close} aria-label="Close">
					<CloseIcon />
				</button>
			</div>
			<div className="loci-coach__ask">
				<a className="loci-primary loci-primary--sm" href={REPO_URL} target="_blank" rel="noreferrer">
					★ Star on GitHub
				</a>
				<a className="loci-secondary loci-secondary--sm" href={`${REPO_URL}#local-setup`} target="_blank" rel="noreferrer">
					Use it on your own notes
				</a>
			</div>
		</div>
	)
}

const adminFetch = (path: string, init: RequestInit = {}) =>
	fetch(path, { ...init, headers: { ...(init.headers ?? {}), 'x-loci-admin': '1', 'Content-Type': 'application/json' } })

/**
 * Record mode (local admin, /?record): ask each step's branches against the live model and keep the
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
		const res = await adminFetch('/api/admin/take', { method: 'POST', body: JSON.stringify({ step: recorded.step.id, branch: recorded.branch.id, take }) })
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
