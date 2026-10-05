'use client'
import { useEffect, useRef, useState } from 'react'
import { MoreIcon, NewBoardIcon, SpeakerIcon } from './icons'
import type { TutorStatus } from '../useTutor'

interface Props {
	busy?: boolean
	library?: React.ReactNode
	status: TutorStatus
	voiceOut: boolean
	voiceProvider: 'fish' | 'browser' | null
	onToggleVoice: () => void
	onClear: () => void
	onSample: () => void
	/** Replay the guided lesson, when the demo pack has one. */
	onTour?: () => void
	/** Remove everything Loci drew, keeping the student's own notes and marks. */
	onEraseDrawings: () => void
}

export function TopBar({ status, voiceOut, voiceProvider, onToggleVoice, onClear, onSample, onTour, onEraseDrawings, busy, library }: Props) {
	const [menu, setMenu] = useState(false)
	const ref = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (!menu) return
		const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setMenu(false)
		window.addEventListener('pointerdown', close)
		return () => window.removeEventListener('pointerdown', close)
	}, [menu])

	return (
		<div className="loci-topbar" data-menu-open={menu} onPointerDown={(e) => e.stopPropagation()}>
			<a className="loci-brand" href="/" style={{ textDecoration: 'none', color: 'inherit' }}>Loci</a>
			<a className="loci-topbar__github" href="https://github.com/keananwongso/loci" target="_blank" rel="noreferrer">★ Star on GitHub</a>

			{library}
			{status.accounts && <a className="loci-topbar__account" href="/account">{status.pro ? 'Pro · Account' : 'Sign in / Pro'}</a>}
			<button className="loci-icon-btn" data-active={voiceOut} onClick={onToggleVoice} title={
					voiceOut
						? `Loci speaks its answers${voiceProvider === 'fish' ? ' (Fish Audio)' : voiceProvider === 'browser' ? " (your browser's voice)" : ''}. Click to turn off.`
						: 'Voice mode: Loci speaks its answers'
				}>
				<SpeakerIcon off={!voiceOut} />
			</button>
			<button
				className="loci-icon-btn"
				onClick={onClear}
				disabled={busy}
				title="New board (keeps your current board saved)"
				aria-label="New board"
			>
				<NewBoardIcon />
			</button>
			<div className="loci-menu" ref={ref}>
				<button className="loci-icon-btn" onClick={() => setMenu((m) => !m)} title="Board menu" aria-expanded={menu}>
					<MoreIcon />
				</button>
				{menu && (
					<div className="loci-menu__list" role="menu">
						{onTour && (
							<button
								role="menuitem"
								disabled={busy}
								onClick={() => {
									setMenu(false)
									onTour()
								}}
							>
								Replay demo
							</button>
						)}
						{!onTour && (
							<button
								role="menuitem"
								disabled={busy}
								onClick={() => {
									setMenu(false)
									onSample()
								}}
							>
								Add sample notes
							</button>
						)}
						<button
							role="menuitem"
							onClick={() => {
								setMenu(false)
								window.dispatchEvent(new CustomEvent('loci:open-key-dialog'))
							}}
						>
							Use your own API key…
						</button>
						<button
							role="menuitem"
							disabled={busy}
							title="Removes everything Loci drew. Your notes, uploads and your own marks stay. Undo with Ctrl/⌘ + Z."
							onClick={() => {
								setMenu(false)
								onEraseDrawings()
							}}
						>
							Erase Loci&rsquo;s drawings
						</button>
					</div>
				)}
			</div>
		</div>
	)
}
