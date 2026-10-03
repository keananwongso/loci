'use client'
/**
 * Local editor for the demo pack in public/demo/: the materials and their roles, the lines the
 * tutor speaks, and the lesson's steps and branches. Takes are recorded in the app (/?record) and
 * the voice is rendered here. Publishing is a commit: everything lives in public/demo/.
 */
import { useCallback, useEffect, useState } from 'react'
import { ROLES, ROLE_LABELS, guessRole } from '@/lib/documents/roles'
import type { DemoBranch, DemoPack, DemoStep } from '@/lib/demo/pack'

interface Status {
	pack: DemoPack
	problems: string[]
	files: string[]
	takes: string[]
	voice: { lines: number; missing: number; fish: boolean }
	model: string
}

const api = (path: string, init: RequestInit = {}) =>
	fetch(path, { ...init, headers: { 'x-loci-admin': '1', ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) } })

const move = <T,>(list: T[], i: number, by: number) => {
	const j = i + by
	if (j < 0 || j >= list.length) return list
	const next = [...list]
	;[next[i], next[j]] = [next[j], next[i]]
	return next
}

const slug = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 32) || 'step'

export function AdminApp() {
	const [status, setStatus] = useState<Status | null>(null)
	const [pack, setPack] = useState<DemoPack | null>(null)
	const [dirty, setDirty] = useState(false)
	const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null)
	const [busy, setBusy] = useState(false)

	const load = useCallback(async () => {
		const res = await api('/api/admin/pack')
		if (!res.ok) return setMessage({ text: 'The admin only works on a dev server opened at localhost.', bad: true })
		const s = (await res.json()) as Status
		setStatus(s)
		setPack(s.pack)
		setDirty(false)
	}, [])

	useEffect(() => {
		load()
	}, [load])

	const edit = (fn: (p: DemoPack) => DemoPack) => {
		setPack((p) => (p ? fn(p) : p))
		setDirty(true)
	}

	const save = async () => {
		if (!pack) return
		setBusy(true)
		const res = await api('/api/admin/pack', { method: 'PUT', body: JSON.stringify(pack) })
		const body = await res.json().catch(() => ({}))
		setBusy(false)
		if (!res.ok) return setMessage({ text: [body.error, ...(body.problems ?? [])].filter(Boolean).join(' · '), bad: true })
		setMessage({ text: 'Saved to public/demo/pack.json.' })
		await load()
	}

	const upload = async (files: FileList | File[]) => {
		setBusy(true)
		const added: DemoPack['materials'] = []
		for (const f of Array.from(files)) {
			const res = await api(`/api/admin/file?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f, headers: { 'Content-Type': 'application/octet-stream' } })
			const body = await res.json().catch(() => ({}))
			if (!res.ok) {
				setMessage({ text: `${f.name}: ${body.error ?? res.status}`, bad: true })
				continue
			}
			added.push({ file: body.file, role: guessRole(body.file) })
		}
		setBusy(false)
		if (added.length) {
			edit((p) => ({ ...p, materials: [...p.materials.filter((m) => !added.some((a) => a.file === m.file)), ...added] }))
			setMessage({ text: `Uploaded ${added.map((a) => a.file).join(', ')}. Save to keep them in the pack.` })
		}
	}

	const removeFile = async (file: string) => {
		if (!confirm(`Delete ${file} from public/demo/?`)) return
		const res = await api(`/api/admin/file?name=${encodeURIComponent(file)}`, { method: 'DELETE' })
		const body = await res.json().catch(() => ({}))
		if (!res.ok) return setMessage({ text: body.error ?? 'Could not delete.', bad: true })
		await load()
	}

	const renderVoice = async () => {
		setBusy(true)
		setMessage({ text: 'Rendering the voice with Fish Audio…' })
		const res = await api('/api/admin/voice', { method: 'POST' })
		const body = await res.json().catch(() => ({}))
		setBusy(false)
		if (!res.ok) return setMessage({ text: body.error ?? 'Rendering failed.', bad: true })
		setMessage({
			text: `Voice: ${body.rendered} rendered, ${body.kept} already up to date, ${body.removed} unused removed.${body.failed?.length ? ` Failed: ${body.failed.join('; ')}` : ''}`,
			bad: Boolean(body.failed?.length),
		})
		await load()
	}

	const clearTake = async (step: DemoStep, branch: DemoBranch) => {
		if (!confirm(`Forget the take for ${step.id} / ${branch.id}? Visitors will get the live model there until you record it again.`)) return
		await api(`/api/admin/take?step=${step.id}&branch=${branch.id}`, { method: 'DELETE' })
		await load()
	}

	if (!pack || !status) return <main className="loci-admin">{message ? <p className="loci-admin__msg" data-bad>{message.text}</p> : <p>Loading…</p>}</main>

	const unused = status.files.filter((f) => !pack.materials.some((m) => m.file === f) && !['pack.json', 'voice.json'].includes(f))
	const setStep = (i: number, fn: (s: DemoStep) => DemoStep) => edit((p) => ({ ...p, steps: p.steps.map((s, j) => (j === i ? fn(s) : s)) }))
	const setBranch = (i: number, k: number, fn: (b: DemoBranch) => DemoBranch) =>
		setStep(i, (s) => ({ ...s, branches: s.branches.map((b, j) => (j === k ? fn(b) : b)) }))
	const missingTakes = pack.steps.flatMap((s) => s.branches.filter((b) => !b.take).map((b) => `${s.id}/${b.id}`))

	return (
		<main className="loci-admin" onDragOver={(e) => e.preventDefault()} onDrop={(e) => (e.preventDefault(), upload(e.dataTransfer.files))}>
			<header className="loci-admin__head">
				<div>
					<h1>Demo pack</h1>
					<p className="loci-admin__fine">
						Edits public/demo/. Publish by committing that folder. Live model for recording: <code>{status.model || 'none'}</code>
					</p>
				</div>
				<div className="loci-admin__actions">
					<a className="loci-secondary loci-secondary--sm" href="/?lesson&reset" target="_blank">
						Preview lesson
					</a>
					<a className="loci-secondary loci-secondary--sm" href="/?record&reset" target="_blank">
						Record takes
					</a>
					<button className="loci-primary loci-primary--sm" disabled={!dirty || busy} onClick={save}>
						{dirty ? 'Save' : 'Saved'}
					</button>
				</div>
			</header>

			{message && (
				<p className="loci-admin__msg" data-bad={message.bad || undefined}>
					{message.text}
				</p>
			)}
			{status.problems.length > 0 && <p className="loci-admin__msg" data-bad>pack.json problems: {status.problems.join(' · ')}</p>}

			<section className="loci-admin__card">
				<h2>Checklist</h2>
				<ul className="loci-admin__checks">
					<li data-ok={!dirty}>{dirty ? 'Unsaved changes' : 'Pack saved'}</li>
					<li data-ok={missingTakes.length === 0}>
						{missingTakes.length ? `No take yet (visitors get the live model): ${missingTakes.join(', ')}` : 'Every branch has a recorded take'}
					</li>
					<li data-ok={status.voice.missing === 0}>
						{status.voice.missing ? `${status.voice.missing} of ${status.voice.lines} lines have no pre-rendered voice` : `All ${status.voice.lines} lines have voice`}
						<button className="loci-chip-btn" disabled={busy || !status.voice.fish} onClick={renderVoice} title={status.voice.fish ? '' : 'Set FISH_API_KEY in .env.local'}>
							Render voice
						</button>
					</li>
				</ul>
			</section>

			<section className="loci-admin__card">
				<h2>Words</h2>
				<label>
					Title <span>shown on the start card</span>
					<input value={pack.title} onChange={(e) => edit((p) => ({ ...p, title: e.target.value }))} />
				</label>
				<label>
					Greeting <span>spoken when the lesson starts</span>
					<textarea rows={2} value={pack.greeting ?? ''} onChange={(e) => edit((p) => ({ ...p, greeting: e.target.value || undefined }))} />
				</label>
				<label>
					Outro <span>spoken after the last step</span>
					<textarea rows={2} value={pack.outro ?? ''} onChange={(e) => edit((p) => ({ ...p, outro: e.target.value || undefined }))} />
				</label>
			</section>

			<section className="loci-admin__card">
				<h2>Materials</h2>
				<p className="loci-admin__fine">Placed on the board in this order. Drop pdfs or images anywhere on this page to add them.</p>
				{pack.materials.map((m, i) => (
					<div key={m.file} className="loci-admin__row">
						<code className="loci-admin__grow">{m.file}</code>
						<select value={m.role} onChange={(e) => edit((p) => ({ ...p, materials: p.materials.map((x, j) => (j === i ? { ...x, role: e.target.value as typeof m.role } : x)) }))}>
							{ROLES.map((r) => (
								<option key={r} value={r}>
									{ROLE_LABELS[r]}
								</option>
							))}
						</select>
						<button className="loci-chip-btn" onClick={() => edit((p) => ({ ...p, materials: move(p.materials, i, -1) }))}>
							↑
						</button>
						<button className="loci-chip-btn" onClick={() => edit((p) => ({ ...p, materials: move(p.materials, i, 1) }))}>
							↓
						</button>
						<button className="loci-chip-btn" disabled={pack.materials.length === 1} onClick={() => edit((p) => ({ ...p, materials: p.materials.filter((_, j) => j !== i) }))}>
							Remove
						</button>
					</div>
				))}
				<div className="loci-admin__row">
					<label className="loci-chip-btn">
						Upload files
						<input type="file" multiple hidden accept=".pdf,image/png,image/jpeg,image/webp" onChange={(e) => e.target.files && upload(e.target.files)} />
					</label>
				</div>
				{unused.length > 0 && (
					<p className="loci-admin__fine">
						Not in the pack:{' '}
						{unused.map((f) => (
							<span key={f} className="loci-admin__unused">
								<code>{f}</code>
								<button className="loci-chip-btn" onClick={() => edit((p) => ({ ...p, materials: [...p.materials, { file: f, role: guessRole(f) }] }))}>
									Add
								</button>
								<button className="loci-chip-btn" onClick={() => removeFile(f)}>
									Delete
								</button>
							</span>
						))}
					</p>
				)}
			</section>

			<section className="loci-admin__card">
				<h2>Lesson steps</h2>
				<p className="loci-admin__fine">
					An <b>ask</b> step suggests a question; whatever the visitor asks replays its take. An <b>answer</b> step waits for the answer to
					the tutor&apos;s check question and picks the first branch with a matching word (an empty list catches everything else, so put it
					last). Takes are recorded in order, each on the board the earlier ones left, so re-record later steps after changing an earlier one.
				</p>
				{pack.steps.map((s, i) => (
					<div key={i} className="loci-admin__step">
						<div className="loci-admin__row">
							<b>{i + 1}.</b>
							<input className="loci-admin__id" value={s.id} onChange={(e) => setStep(i, (x) => ({ ...x, id: slug(e.target.value) }))} />
							<select value={s.kind} onChange={(e) => setStep(i, (x) => ({ ...x, kind: e.target.value as DemoStep['kind'] }))}>
								<option value="ask">ask</option>
								<option value="answer">answer</option>
							</select>
							<span className="loci-admin__grow" />
							<button className="loci-chip-btn" onClick={() => edit((p) => ({ ...p, steps: move(p.steps, i, -1) }))}>
								↑
							</button>
							<button className="loci-chip-btn" onClick={() => edit((p) => ({ ...p, steps: move(p.steps, i, 1) }))}>
								↓
							</button>
							<button className="loci-chip-btn" onClick={() => confirm(`Delete step ${s.id}?`) && edit((p) => ({ ...p, steps: p.steps.filter((_, j) => j !== i) }))}>
								Delete
							</button>
						</div>
						<label>
							Instruction <span>spoken before the step</span>
							<input value={s.intro ?? ''} onChange={(e) => setStep(i, (x) => ({ ...x, intro: e.target.value || undefined }))} />
						</label>
						<label>
							{s.kind === 'ask' ? 'Suggested question' : 'Hint while waiting'}
							<input value={s.prompt} onChange={(e) => setStep(i, (x) => ({ ...x, prompt: e.target.value }))} />
						</label>
						{s.kind === 'ask' && (
							<div className="loci-admin__row">
								<label className="loci-admin__grow">
									Point at <span>exact text on the page, pulsed as a hint</span>
									<input
										value={s.point?.text ?? ''}
										onChange={(e) =>
											setStep(i, (x) => ({
												...x,
												point: e.target.value ? { file: x.point?.file ?? pack.materials[0].file, page: x.point?.page ?? 1, text: e.target.value } : undefined,
											}))
										}
									/>
								</label>
								{s.point && (
									<>
										<select value={s.point.file} onChange={(e) => setStep(i, (x) => ({ ...x, point: { ...x.point!, file: e.target.value } }))}>
											{pack.materials.map((m) => (
												<option key={m.file}>{m.file}</option>
											))}
										</select>
										<input
											type="number"
											min={1}
											className="loci-admin__page"
											value={s.point.page}
											onChange={(e) => setStep(i, (x) => ({ ...x, point: { ...x.point!, page: Math.max(1, Number(e.target.value) || 1) } }))}
										/>
									</>
								)}
							</div>
						)}
						<div className="loci-admin__branches">
							{s.branches.map((b, k) => (
								<div key={k} className="loci-admin__row loci-admin__branch">
									<input className="loci-admin__id" value={b.id} onChange={(e) => setBranch(i, k, (x) => ({ ...x, id: slug(e.target.value) }))} />
									{s.kind === 'answer' && (
										<input
											className="loci-admin__grow"
											placeholder="matching words, comma separated (empty: anything else)"
											value={b.match.join(', ')}
											onChange={(e) =>
												setBranch(i, k, (x) => ({
													...x,
													match: e.target.value
														.split(',')
														.map((w) => w.trim())
														.filter(Boolean),
												}))
											}
										/>
									)}
									{s.kind === 'answer' && (
										<input
											className="loci-admin__grow"
											placeholder="sample answer to record with"
											value={b.sample ?? ''}
											onChange={(e) => setBranch(i, k, (x) => ({ ...x, sample: e.target.value || undefined }))}
										/>
									)}
									<select value={b.next} onChange={(e) => setBranch(i, k, (x) => ({ ...x, next: e.target.value as DemoBranch['next'] }))}>
										<option value="continue">then next step</option>
										<option value="retry">then try again</option>
									</select>
									{b.take ? (
										<button className="loci-chip-btn" data-ok onClick={() => clearTake(s, b)} title={b.take}>
											Recorded ✓
										</button>
									) : (
										<span className="loci-admin__fine">no take</span>
									)}
									{s.branches.length > 1 && (
										<button className="loci-chip-btn" onClick={() => setStep(i, (x) => ({ ...x, branches: x.branches.filter((_, j) => j !== k) }))}>
											×
										</button>
									)}
								</div>
							))}
							{s.kind === 'answer' && (
								<button
									className="loci-chip-btn"
									onClick={() => setStep(i, (x) => ({ ...x, branches: [...x.branches, { id: `branch-${x.branches.length + 1}`, match: [], next: 'retry' }] }))}
								>
									Add branch
								</button>
							)}
						</div>
					</div>
				))}
				<div className="loci-admin__row">
					<button
						className="loci-chip-btn"
						onClick={() =>
							edit((p) => ({
								...p,
								steps: [...p.steps, { id: `step-${p.steps.length + 1}`, kind: 'ask', prompt: 'A question about the notes', branches: [{ id: 'any', match: [], next: 'continue' }] }],
							}))
						}
					>
						Add ask step
					</button>
					<button
						className="loci-chip-btn"
						onClick={() =>
							edit((p) => ({
								...p,
								steps: [
									...p.steps,
									{
										id: `check-${p.steps.length + 1}`,
										kind: 'answer',
										prompt: 'Answer my question, out loud or by typing',
										branches: [
											{ id: 'right', match: [], next: 'continue' },
											{ id: 'other', match: [], next: 'retry' },
										],
									},
								],
							}))
						}
					>
						Add answer step
					</button>
				</div>
			</section>
		</main>
	)
}
