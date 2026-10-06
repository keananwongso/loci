'use client'
import { useEffect, useRef, useState } from 'react'
import { ROLES, ROLE_LABELS, guessRole, type MaterialRole } from '@/lib/documents/roles'

const ROLE_HINTS: Record<MaterialRole, string> = {
	notes: 'Loci teaches from it',
	questions: 'Work through it together',
	syllabus: 'Keeps answers in scope, even off-screen',
	'mark-scheme': 'Used to mark your work, even off-screen',
}

/** Uploading by choice: say what each file is before it lands, starting from a guess by its name. */
export function AddMaterial({ files, onAdd, onClose, onChoose, onLink, onText }: { files: File[]; onAdd: (items: { file: File; role: MaterialRole }[]) => void; onClose: () => void; onChoose: () => void; onLink: (url: string, role: MaterialRole, signal: AbortSignal) => Promise<void>; onText: (text: string, role: MaterialRole) => Promise<void> }) {
	const [roles, setRoles] = useState(() => files.map((f) => guessRole(f.name)))
	const [url, setUrl] = useState('')
	const [text, setText] = useState('')
	const [mode, setMode] = useState<'link' | 'text'>('link')
	const [linkRole, setLinkRole] = useState<MaterialRole>('notes')
	const [pending, setPending] = useState(false)
	const [error, setError] = useState('')
	const abort = useRef<AbortController | null>(null)
	const ref = useRef<HTMLDialogElement>(null)
	useEffect(() => { ref.current?.showModal(); return () => abort.current?.abort() }, [])
	return (
		<dialog className="loci-entry loci-add" aria-labelledby="loci-add-title" ref={ref} onCancel={(e) => { if (pending) e.preventDefault(); else onClose() }}
			onClick={(e) => { if (!pending && e.target === e.currentTarget) onClose() }}>
			<h2 id="loci-add-title">{files.length ? (files.length === 1 ? 'What is this?' : 'What are these?') : 'Add material'}</h2>
			<p>It changes how Loci uses it. You can switch it later by selecting the page.</p>
			{!files.length && <button className="loci-primary" disabled={pending} onClick={onChoose}>Choose PDFs or images</button>}
			{files.length > 0 && <form onSubmit={(e) => { e.preventDefault(); onAdd(files.map((file, i) => ({ file, role: roles[i] }))) }}>
				<ul className="loci-add__files">
					{files.map((file, i) => <li key={`${file.name}-${i}`}>
						<span className="loci-add__name" title={file.name}>{file.name}</span>
						<span className="loci-role-switch" role="radiogroup" aria-label={`What ${file.name} is`}>
							{ROLES.map((r) => <button key={r} type="button" role="radio" aria-checked={r === roles[i]} className="loci-role" data-role={r}
								data-active={r === roles[i] || undefined} title={ROLE_HINTS[r]}
								onClick={() => setRoles((all) => all.map((v, j) => (j === i ? r : v)))}>{ROLE_LABELS[r]}</button>)}
						</span>
						<span className="loci-add__hint">{ROLE_HINTS[roles[i]]}</span>
					</li>)}
				</ul>
				<div className="loci-landing__actions">
					<button className="loci-primary" type="submit" autoFocus>Add to board</button>
					<button className="loci-coach__skip" type="button" onClick={onClose}>Cancel</button>
				</div>
			</form>}
			{!files.length && <div className="loci-add__modes"><button aria-pressed={mode === 'link'} disabled={pending} onClick={() => { setMode('link'); setError('') }}>Paste a link</button><button aria-pressed={mode === 'text'} disabled={pending} onClick={() => { setMode('text'); setError('') }}>Paste notes</button></div>}
			{!files.length && <form className="loci-add__link" onSubmit={async e => {
				e.preventDefault(); if (pending) return
				const controller = new AbortController(); abort.current = controller; setPending(true); setError('')
				try { if (mode === 'link') await onLink(url.trim(), linkRole, controller.signal); else await onText(text.trim(), linkRole) } catch (err) { setError(err instanceof Error ? err.message : 'Could not import this link.') } finally { setPending(false) }
			}}>
				{mode === 'link' ? <><label htmlFor="material-link">Public article or PDF link</label><input id="material-link" type="url" placeholder="https://…" value={url} maxLength={2000} disabled={pending} onChange={e => setUrl(e.target.value)} required /></> : <><label htmlFor="material-text">Paste your notes</label><textarea id="material-text" value={text} maxLength={100000} rows={6} disabled={pending} onChange={e => setText(e.target.value)} required /></>}
				<label htmlFor="link-role">Use it as</label><select id="link-role" value={linkRole} disabled={pending} onChange={e => setLinkRole(e.target.value as MaterialRole)}>{ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select>
				{mode === 'link' && <p>Public articles and direct PDF links are supported. Pages requiring a login should be exported and uploaded.</p>}
				{error && <p role="alert">{error}</p>}
				<div className="loci-landing__actions"><button className="loci-primary" type="submit" disabled={pending || !(mode === 'link' ? url.trim() : text.trim())}>{pending ? 'Importing…' : mode === 'link' ? 'Add link' : 'Add notes'}</button><button type="button" disabled={pending} onClick={onClose}>Cancel</button></div>
			</form>}
		</dialog>
	)
}
