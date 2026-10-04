'use client'
import { useEffect, useRef, useState } from 'react'
import { MoreIcon, NewBoardIcon, SpeakerIcon } from './icons'
import type { TutorStatus } from '../useTutor'

interface Props {
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

export function TopBar({ status, voiceOut, voiceProvider, onToggleVoice, onClear, onSample, onTour, onEraseDrawings }: Props) {
	const [menu, setMenu] = useState(false)
	const ref = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (!menu) return
		const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setMenu(false)
		window.addEventListener('pointerdown', close)
		return () => window.removeEventListener('pointerdown', close)
	}, [menu])

	return (
		<div className="loci-topbar" onPointerDown={(e) => e.stopPropagation()}>
			<a className="loci-brand" href="/" style={{ textDecoration: 'none', color: 'inherit' }}>Loci</a>
			<a className="loci-topbar__github" href="https://github.com/keananwongso/loci" target="_blank" rel="noreferrer">★ Star on GitHub</a>
			{status.checked && (
				<span className="loci-model" data-ok={status.configured} title={status.configured ? `Tutor model via ${status.provider}` : status.setupHint}>
					<span className="loci-model__dot" />
					{status.configured ? status.model : 'No model connected'}
				</span>
			)}
			<button className="loci-icon-btn" data-active={voiceOut} onClick={onToggleVoice} title={
					voiceOut
						? `Loci speaks its answers${voiceProvider === 'fish' ? ' (Fish Audio)' : voiceProvider === 'browser' ? " (your browser's voice)" : ''}. Click to turn off.`
						: 'Voice mode: Loci speaks its answers'
				}>
				<SpeakerIcon off={!voiceOut} />
			</button>
			<button
				className="loci-icon-btn"
				onClick={() => confirm('Start a new board? This clears the canvas and the conversation.') && onClear()}
				title="New board (clears the canvas and conversation)"
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
								onClick={() => {
									setMenu(false)
									onTour()
								}}
							>
								Replay the lesson
							</button>
						)}
						<button
							role="menuitem"
							onClick={() => {
								setMenu(false)
								onSample()
							}}
						>
							Add sample notes
						</button>
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
							title="Removes everything Loci drew. Your notes, uploads and your own marks stay. Undo with Ctrl/⌘ + Z."
							onClick={() => {
								setMenu(false)
								onEraseDrawings()
							}}
						>
							Erase Loci&rsquo;s drawings
						</button>
						<a role="menuitem" href="https://github.com/keananwongso/loci" target="_blank" rel="noreferrer">
							Source code on GitHub
						</a>
						<button
							role="menuitem"
							className="loci-danger"
							onClick={() => {
								setMenu(false)
								if (confirm('Clear the whole board and conversation? This cannot be undone.')) onClear()
							}}
						>
							Clear board…
						</button>
					</div>
				)}
			</div>
		</div>
	)
}
