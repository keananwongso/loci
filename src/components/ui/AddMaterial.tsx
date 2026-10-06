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
export function AddMaterial({ files, onAdd, onClose }: { files: File[]; onAdd: (items: { file: File; role: MaterialRole }[]) => void; onClose: () => void }) {
	const [roles, setRoles] = useState(() => files.map((f) => guessRole(f.name)))
	const ref = useRef<HTMLDialogElement>(null)
	useEffect(() => { ref.current?.showModal() }, [])
	return (
		<dialog className="loci-entry loci-add" aria-labelledby="loci-add-title" ref={ref} onCancel={onClose}
			onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
			<h2 id="loci-add-title">{files.length === 1 ? 'What is this?' : 'What are these?'}</h2>
			<p>It changes how Loci uses it. You can switch it later by selecting the page.</p>
			<form onSubmit={(e) => { e.preventDefault(); onAdd(files.map((file, i) => ({ file, role: roles[i] }))) }}>
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
			</form>
		</dialog>
	)
}
