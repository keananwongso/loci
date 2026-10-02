'use client'
import { useEffect, useRef, useState } from 'react'
import { MoreIcon, SpeakerIcon } from './icons'
import type { TutorStatus } from '../useTutor'
import { canSpeak } from '@/lib/voice/speech'

interface Props {
	status: TutorStatus
	voiceOut: boolean
	onToggleVoice: () => void
	onClear: () => void
	onSample: () => void
}

export function TopBar({ status, voiceOut, onToggleVoice, onClear, onSample }: Props) {
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
			<span className="loci-brand">Loci</span>
			{status.checked && (
				<span className="loci-model" data-ok={status.configured} title={status.configured ? `Tutor model via ${status.provider}` : status.setupHint}>
					<span className="loci-model__dot" />
					{status.configured ? status.model : 'No model connected'}
				</span>
			)}
			{canSpeak() && (
				<button className="loci-icon-btn" data-active={voiceOut} onClick={onToggleVoice} title={voiceOut ? 'Stop reading answers aloud' : 'Read answers aloud'}>
					<SpeakerIcon off={!voiceOut} />
				</button>
			)}
			<div className="loci-menu" ref={ref}>
				<button className="loci-icon-btn" onClick={() => setMenu((m) => !m)} title="Board menu" aria-expanded={menu}>
					<MoreIcon />
				</button>
				{menu && (
					<div className="loci-menu__list" role="menu">
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
