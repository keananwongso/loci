'use client'
import { useEffect, useRef, useState } from 'react'
import type { WorkspaceLibrary } from '@/lib/storage/workspaces'

export function BoardLibrary({ library, disabled, onSelect, onNew, onRename }: {
	library: WorkspaceLibrary; disabled: boolean; onSelect: (id: string) => void; onNew: () => void; onRename: (name: string) => void
}) {
	const [open, setOpen] = useState(false)
	const ref = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (!open) return
		const close = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }
		const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
		window.addEventListener('pointerdown', close)
		window.addEventListener('keydown', escape)
		return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape) }
	}, [open])
	const board = library.boards.find((b) => b.id === library.active)!
	return <div ref={ref} className="loci-board-library">
		<button className="loci-chip-btn" disabled={disabled} onClick={() => setOpen(!open)} aria-expanded={open}>{board.name} ▾</button>
		{open && <div className="loci-board-library__list">
			<p>Saved in this browser</p>
			{library.boards.map((b) => <button key={b.id} aria-current={b.id === board.id ? 'true' : undefined} onClick={() => { onSelect(b.id); setOpen(false) }}>{b.name}{b.id === board.id ? ' ✓' : ''}</button>)}
			<button onClick={() => { onNew(); setOpen(false) }}>＋ New board</button>
			<form onSubmit={(e) => { e.preventDefault(); const name = new FormData(e.currentTarget).get('name')?.toString().trim(); if (name) { onRename(name.slice(0, 80)); setOpen(false) } }}>
				<label htmlFor="board-name">Rename this board</label>
				<input id="board-name" name="name" defaultValue={board.name} maxLength={80} required />
				<button type="submit">Save name</button>
			</form>
		</div>}
	</div>
}
