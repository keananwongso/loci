'use client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import type { WorkspaceLibrary } from '@/lib/storage/workspaces'

/** The library opens from the board title, or by approaching the left edge. */
export function BoardLibrary({ library, account = false, disabled, onSelect, onNew, onRename, onNewSpace, onMove }: {
	library: WorkspaceLibrary; account?: boolean; disabled: boolean; onSelect: (id: string) => void; onNew: () => void; onRename: (name: string) => void; onNewSpace: (name: string) => void; onMove: (spaceId: string | null) => void
}) {
	const [open, setOpen] = useState(false)
	const [query, setQuery] = useState('')
	const [mounted, setMounted] = useState(false)
	const [addingSpace, setAddingSpace] = useState(false)
	const panel = useRef<HTMLElement>(null)
	const trigger = useRef<HTMLButtonElement>(null)
	const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const board = library.boards.find((b) => b.id === library.active)!
	const cancelLeave = () => clearTimeout(leaveTimer.current)
	const close = () => { cancelLeave(); setOpen(false) }
	useEffect(() => { setMounted(true); return () => clearTimeout(leaveTimer.current) }, [])
	useEffect(() => {
		if (!open) return
		const outside = (event: PointerEvent) => {
			if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false)
		}
		const escape = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			event.preventDefault()
			if (panel.current?.contains(document.activeElement)) trigger.current?.focus()
			setOpen(false)
		}
		window.addEventListener('pointerdown', outside)
		window.addEventListener('keydown', escape)
		return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape) }
	}, [open])
	const needle = query.trim().toLowerCase()
	const spaces = library.spaces ?? []
	const knownSpaces = new Set(spaces.map((s) => s.id))
	const groups = [
		{ id: '', name: account ? 'Boards outside spaces' : 'This browser', boards: library.boards.filter((b) => !b.spaceId || !knownSpaces.has(b.spaceId)) },
		...spaces.map((s) => ({ ...s, boards: library.boards.filter((b) => b.spaceId === s.id) })),
	].map((g) => ({ ...g, boards: [...g.boards].sort((a, b) => b.updatedAt - a.updatedAt).filter((b) => !needle || b.name.toLowerCase().includes(needle) || g.name.toLowerCase().includes(needle)) }))
	const noResults = needle && !groups.some((g) => g.boards.length)
	return <div className="loci-board-library">
		<button ref={trigger} className="loci-chip-btn" onClick={() => { cancelLeave(); setOpen(!open) }} aria-label={`Open spaces and boards. Current board: ${board.name}`} aria-expanded={open} aria-controls="loci-board-sidebar" title="Spaces and boards">
			<span aria-hidden>☰</span> {board.name}
		</button>
		{mounted && createPortal(<>
			<div className="loci-sidebar-edge" aria-hidden onPointerEnter={(event) => {
				if (event.pointerType === 'mouse' && event.buttons === 0) { cancelLeave(); setOpen(true) }
			}} onPointerDown={(event) => event.stopPropagation()} />
			{open && <nav id="loci-board-sidebar" ref={panel} className="loci-board-sidebar" aria-label="Spaces and boards"
				onPointerDown={(event) => event.stopPropagation()}
				onPointerEnter={cancelLeave}
				onPointerLeave={(event) => {
					if (event.pointerType !== 'mouse') return
					cancelLeave()
					leaveTimer.current = setTimeout(() => { if (!panel.current?.contains(document.activeElement)) setOpen(false) }, 250)
				}}
				onKeyDown={(event) => { if (event.key !== 'Escape') event.stopPropagation() }}
				onFocus={cancelLeave}
				onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close() }}>
				<header><div><strong>Spaces & boards</strong><p>{account ? 'Saved to your account' : 'Saved in this browser'}</p></div><button className="loci-icon-btn" aria-label="Close sidebar" onClick={() => { trigger.current?.focus(); close() }}>×</button></header>
				<label className="loci-sr-only" htmlFor="loci-board-search">Find a board or space</label>
				<input id="loci-board-search" type="search" placeholder="Find a board or space…" value={query} onChange={(event) => setQuery(event.target.value)} />
				<button className="loci-sidebar-new" disabled={disabled} onClick={() => { onNew(); close() }}>＋ New board</button>
				<button className="loci-sidebar-new" disabled={disabled} onClick={() => setAddingSpace(v => !v)}>＋ New space</button>
				{addingSpace && <form onSubmit={e => { e.preventDefault(); const name = new FormData(e.currentTarget).get('space')?.toString().trim(); if (name) { onNewSpace(name); setAddingSpace(false) } }}><label htmlFor="new-space-name">Space name</label><div><input id="new-space-name" name="space" placeholder="e.g. Linear algebra" maxLength={80} required disabled={disabled} autoFocus /><button type="submit" disabled={disabled}>Create</button></div></form>}
				<div className="loci-board-sidebar__groups">
					{noResults && <p className="loci-sidebar-empty" role="status">No matching boards.</p>}
					{groups.filter((g) => !needle || g.boards.length).map((group) => <details key={group.id} open>
						<summary>{group.name}<span>{group.boards.length}</span></summary>
						{group.boards.length === 0 && <p className="loci-sidebar-empty">No boards in this space yet.</p>}
						{group.boards.map((b) => <button key={b.id} disabled={disabled} aria-current={b.id === library.active ? 'page' : undefined} onClick={() => { if (b.id !== library.active) onSelect(b.id); close() }}>
							<span aria-hidden>▧</span><span>{b.name}</span>{b.id === library.active && <span className="loci-sidebar-current" aria-hidden>●</span>}
						</button>)}
					</details>)}
				</div>
				<footer>
					<form key={board.id + board.name} onSubmit={(event) => {
						event.preventDefault()
						const name = new FormData(event.currentTarget).get('name')?.toString().trim()
						if (name) onRename(name.slice(0, 80))
					}}>
						<label htmlFor="board-name">Current board</label>
						<div><input id="board-name" name="name" defaultValue={board.name} maxLength={80} required disabled={disabled} /><button type="submit" disabled={disabled}>Rename</button></div>
					</form>
					<label className="loci-sidebar-space-label" htmlFor="current-board-space">Space</label><select id="current-board-space" disabled={disabled} value={board.spaceId || ''} onChange={e => onMove(e.target.value || null)}><option value="">Outside spaces</option>{spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
					{account && <Link href="/home">All boards →</Link>}
				</footer>
			</nav>}
		</>, document.body)}
	</div>
}
