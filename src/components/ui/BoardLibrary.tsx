'use client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { RectIcon, UploadIcon, MoreIcon } from './icons'
import { moveWorkspace, removeWorkspace, removeSpace, type WorkspaceLibrary } from '@/lib/storage/workspaces'

/** Visible navigation stays separate from the canvas drawing tools. */
export function BoardLibrary({ library, account = false, disabled, onSelect, onNew, onRename, onNewSpace, onMove, onUpload, onChange }: {
 onChange: (library: WorkspaceLibrary) => void; library: WorkspaceLibrary; account?: boolean; disabled: boolean; onSelect: (id: string) => void; onNew: () => void; onRename: (name: string) => void; onNewSpace: (name: string) => void; onMove: (spaceId: string | null) => void; onUpload: () => void
}) {
 const [open, setOpen] = useState(false)
 const [view, setView] = useState<'boards' | 'spaces'>('boards')
 const [query, setQuery] = useState('')
 const [mounted, setMounted] = useState(false)
 const [addingSpace, setAddingSpace] = useState(false)
 const [settings, setSettings] = useState(false)
 const [menu, setMenu] = useState<string | null>(null)
 const [over, setOver] = useState<string|null>(null)
 const panel = useRef<HTMLElement>(null), rail = useRef<HTMLElement>(null), trigger = useRef<HTMLButtonElement>(null)
 const board = library.boards.find(b => b.id === library.active)!
 const close = () => setOpen(false)
 const toggle = (next: 'boards' | 'spaces') => { setView(next); setOpen(!(open && view === next)) }
 useEffect(() => { setMounted(true) }, [])
 useEffect(() => {
  if (!open) return
  const outside = (event: PointerEvent) => {
   if (![panel.current, rail.current, trigger.current].some(el => el?.contains(event.target as Node))) setOpen(false)
  }
  const escape = (event: KeyboardEvent) => {
   if (event.key !== 'Escape') return
   event.preventDefault(); event.stopPropagation()
   if (panel.current?.contains(document.activeElement)) rail.current?.querySelector<HTMLButtonElement>(`button[aria-label="${view === 'boards' ? 'Boards' : 'Spaces'}"]`)?.focus()
   setOpen(false)
  }
  window.addEventListener('pointerdown', outside)
  window.addEventListener('keydown', escape)
  return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape) }
 }, [open, view])
 const needle = query.trim().toLowerCase(), spaces = library.spaces ?? []
 const known = new Set(spaces.map(s => s.id))
 const groups = [
  { id: '', name: 'Unsorted', boards: library.boards.filter(b => !b.spaceId || !known.has(b.spaceId)) },
  ...spaces.map(s => ({ ...s, boards: library.boards.filter(b => b.spaceId === s.id) })),
 ].filter(g => view === 'boards' || g.id).map(g => ({ ...g, boards: g.boards.filter(b => !needle || b.name.toLowerCase().includes(needle) || g.name.toLowerCase().includes(needle)) })).filter(g => !needle || g.boards.length || g.name.toLowerCase().includes(needle))
 return <div className="loci-board-library">
  <button ref={trigger} className="loci-chip-btn" onClick={() => { setView('boards'); setOpen(!open) }} aria-label={`Open boards. Current board: ${board.name}`} aria-expanded={open} aria-controls="loci-board-sidebar" title="Boards">{board.name}</button>
  {mounted && createPortal(<>
   <nav className="loci-nav-rail" ref={rail} aria-label="Workspace navigation" onPointerDown={e => e.stopPropagation()}>
    <a className="loci-nav-rail__brand" href={account ? '/home' : '/'} aria-label="Loci home"><img src="/brand/loci-symbol-color.svg" alt="" /></a>
    <button aria-label="Boards" title="Boards" aria-expanded={open && view === 'boards'} aria-controls="loci-board-sidebar" onClick={() => toggle('boards')}><RectIcon /><span>Boards</span></button>
    <button aria-label="Spaces" title="Spaces" aria-expanded={open && view === 'spaces'} aria-controls="loci-board-sidebar" onClick={() => toggle('spaces')}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z" /></svg><span>Spaces</span></button>
    <button aria-label="Add material" title="Add notes, PDF or link" disabled={disabled} onClick={() => { close(); onUpload() }}><UploadIcon /><span>Add</span></button>
    <div className="loci-nav-rail__bottom">
     <button aria-label="API key settings" title="API key settings" onClick={() => { close(); window.dispatchEvent(new CustomEvent('loci:open-key-dialog')) }}><MoreIcon /><span>API key</span></button>
     <a href="/account" aria-label="Account" title="Account"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden><circle cx="12" cy="8" r="3" /><path d="M5 21v-3a7 7 0 0 1 14 0v3" /></svg><span>Account</span></a>
    </div>
   </nav>
   {open && <nav id="loci-board-sidebar" ref={panel} className="loci-board-sidebar" aria-label="Spaces and boards" onPointerDown={e => e.stopPropagation()} onKeyDown={e => { if (e.key !== 'Escape') e.stopPropagation() }}>
    <header><div><strong>{view === 'boards' ? 'Boards' : 'Spaces'}</strong><p>{account ? 'Saved to your account' : 'Saved in this browser'}</p></div><button className="loci-icon-btn" aria-label="Close sidebar" onClick={() => { trigger.current?.focus(); close() }}>×</button></header>
    <label className="loci-sr-only" htmlFor="loci-board-search">Find a board or space</label>
    <input id="loci-board-search" type="search" placeholder="Search boards and spaces" value={query} onChange={e => setQuery(e.target.value)} />
    <div className="loci-sidebar-actions"><button className="loci-sidebar-new" disabled={disabled} onClick={() => { onNew(); close() }}>＋ Board</button><button className="loci-sidebar-new" disabled={disabled} onClick={() => setAddingSpace(v => !v)}>＋ Space</button></div>
    {addingSpace && <form onSubmit={e => { e.preventDefault(); const name = new FormData(e.currentTarget).get('space')?.toString().trim(); if (name) { onNewSpace(name); setAddingSpace(false); setView('spaces') } }}><label htmlFor="new-space-name">Space name</label><div><input id="new-space-name" name="space" placeholder="e.g. Linear algebra" maxLength={80} required disabled={disabled} autoFocus /><button type="submit" disabled={disabled}>Create</button></div></form>}
    <div className="loci-board-sidebar__groups">
     {!groups.length && <p className="loci-sidebar-empty" role="status">{needle ? 'No matching boards or spaces.' : 'Create a space to organize your boards.'}</p>}
     <p className="loci-sidebar-drag-hint">Drag boards to reorder or move between spaces.</p>
     {groups.map(group => <details key={group.id} open data-drop={over===`space:${group.id}`} onDragOver={e=>{if(disabled || !e.dataTransfer.types.some(t=>t==='application/x-loci-board' || t==='application/x-loci-space'))return;e.preventDefault();setOver(`space:${group.id}`)}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOver(null)}} onDrop={e=>{
      e.preventDefault();e.stopPropagation();if(disabled)return
      const boardId=e.dataTransfer.getData('application/x-loci-board'),spaceId=e.dataTransfer.getData('application/x-loci-space')
      if(boardId)onChange(moveWorkspace(library,boardId,group.id || null))
      else if(spaceId && group.id && group.id!==spaceId){const next=spaces.filter(s=>s.id!==spaceId);const moved=spaces.find(s=>s.id===spaceId);if(moved){next.splice(next.findIndex(s=>s.id===group.id),0,moved);onChange({...library,spaces:next})}}
      setOver(null)
     }}>
      <summary draggable={Boolean(group.id) && !disabled} onDragStart={e=>{if(!group.id)return;e.dataTransfer.setData('text/plain',group.id);e.dataTransfer.setData('application/x-loci-space',group.id);e.dataTransfer.effectAllowed='move';}} onDragEnd={()=>{setOver(null)}}>{group.name}<span>{group.boards.length}</span>{group.id && <button className="loci-sidebar-delete-space" disabled={disabled} aria-label={`Delete space ${group.name}`} title="Delete space (keep its boards)" onClick={e=>{e.preventDefault();e.stopPropagation();if(window.confirm(`Delete space “${group.name}”? Its boards will move to Unsorted.`))onChange(removeSpace(library,group.id))}}>×</button>}</summary>
      {!group.boards.length && <p className="loci-sidebar-empty">Drop a board here.</p>}
      {group.boards.map((b,index) => <div className="loci-sidebar-board-row" key={b.id} data-drop={over===`board:${b.id}`} draggable={!disabled} onDragStart={e=>{e.stopPropagation();e.dataTransfer.setData('text/plain',b.id);e.dataTransfer.setData('application/x-loci-board',b.id);e.dataTransfer.effectAllowed='move';setMenu(null)}} onDragEnd={()=>{setOver(null)}} onDragOver={e=>{if(disabled || !e.dataTransfer.types.includes('application/x-loci-board'))return;e.preventDefault();e.stopPropagation();setOver(`board:${b.id}`)}} onDrop={e=>{const id=e.dataTransfer.getData('application/x-loci-board');if(disabled || !id)return;e.preventDefault();e.stopPropagation();onChange(moveWorkspace(library,id,group.id || null,b.id));setOver(null)}}>
       <button draggable={!disabled} disabled={disabled} aria-current={b.id === library.active ? 'page' : undefined} onClick={() => { if (b.id !== library.active) onSelect(b.id); close() }}><RectIcon /><span>{b.name}</span>{b.id === library.active && <span className="loci-sidebar-current" aria-hidden>●</span>}</button>
       <button className="loci-sidebar-row-menu" aria-label={`Actions for ${b.name}`} aria-expanded={menu===b.id} disabled={disabled} onClick={()=>setMenu(menu===b.id ? null : b.id)}><MoreIcon /></button>
       {menu===b.id && <div className="loci-sidebar-board-actions" draggable={false} onDragStart={e=>e.stopPropagation()}>
        <label>Move to<select aria-label={`Move ${b.name} to space`} value={b.spaceId || ''} disabled={disabled} onChange={e=>{onChange(moveWorkspace(library,b.id,e.target.value || null));setMenu(null)}}><option value="">Unsorted</option>{spaces.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <div><button disabled={disabled || index===0 || Boolean(needle)} onClick={()=>onChange(moveWorkspace(library,b.id,group.id || null,group.boards[index-1].id))}>↑ Move up</button><button disabled={disabled || index===group.boards.length-1 || Boolean(needle)} onClick={()=>onChange(moveWorkspace(library,group.boards[index+1].id,group.id || null,b.id))}>↓ Move down</button></div>
        <button className="loci-sidebar-delete" disabled={disabled} onClick={()=>{if(window.confirm(`Delete board “${b.name}”? This removes its notes, drawings and conversation${account ? ' from your account' : ' from your board list'}.`)){onChange(removeWorkspace(library,b.id));setMenu(null)}}}>Delete board</button>
       </div>}
      </div>)}
     </details>)}
    </div>
    <footer>
     <button className="loci-sidebar-settings" aria-expanded={settings} onClick={() => setSettings(!settings)}>Board settings <span aria-hidden>{settings ? '−' : '+'}</span></button>
     {settings && <div className="loci-sidebar-settings__content">
      <form key={board.id + board.name} onSubmit={e => { e.preventDefault(); const name = new FormData(e.currentTarget).get('name')?.toString().trim(); if (name) onRename(name.slice(0, 80)) }}><label htmlFor="board-name">Board name</label><div><input id="board-name" name="name" defaultValue={board.name} maxLength={80} required disabled={disabled} /><button type="submit" disabled={disabled}>Rename</button></div></form>
      <label className="loci-sidebar-space-label" htmlFor="current-board-space">Move to space</label><select id="current-board-space" disabled={disabled} value={board.spaceId || ''} onChange={e => onMove(e.target.value || null)}><option value="">Unsorted</option>{spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
     </div>}
     {account && <Link href="/home">All boards →</Link>}
    </footer>
   </nav>}
  </>, document.body)}
 </div>
}
