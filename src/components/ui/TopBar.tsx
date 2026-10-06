'use client'
import { BrandLogo } from '@/components/ui/BrandLogo'
import { useEffect, useRef, useState } from 'react'
import { MoreIcon, SpeakerIcon } from './icons'
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
	/** On a board saved to an account: the plan, and where the save stands. */
	account?: { pro: boolean; saveState: React.ReactNode }
}

export function TopBar({ status, voiceOut, voiceProvider, onToggleVoice, onClear, onSample, onTour, onEraseDrawings, busy, library, account }: Props) {
	const [menu, setMenu] = useState(false)
	const ref = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (!menu) return
		const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setMenu(false)
		window.addEventListener('pointerdown', close)
		return () => window.removeEventListener('pointerdown', close)
	}, [menu])

	return (
		<>
		<div className="loci-topbar" data-menu-open={menu} onPointerDown={(e) => e.stopPropagation()}>
			<a className="loci-brand" href={account ? '/home' : '/'} title={account ? 'Your boards' : undefined} style={{ textDecoration: 'none', color: 'inherit' }}><BrandLogo /></a>

			{library}
			{account?.saveState}
			<span className="loci-topbar__divider" aria-hidden />
			<button className="loci-icon-btn" data-active={voiceOut} onClick={onToggleVoice} title={
					voiceOut
						? `Loci speaks its answers${voiceProvider === 'fish' ? ' (Fish Audio)' : voiceProvider === 'browser' ? " (your browser's voice)" : ''}. Click to turn off.`
						: 'Voice mode: Loci speaks its answers'
				}>
				<SpeakerIcon off={!voiceOut} />
			</button>
			<div className="loci-menu" ref={ref}>
				<button className="loci-icon-btn" onClick={() => setMenu((m) => !m)} title="Board menu" aria-expanded={menu}>
					<MoreIcon />
				</button>
				{menu && (
					<div className="loci-menu__list" role="menu">
						<button role="menuitem" disabled={busy} onClick={() => { setMenu(false); onClear() }}>New board</button>
						<a role="menuitem" href="https://github.com/keananwongso/loci" target="_blank" rel="noreferrer" onClick={() => setMenu(false)}>★ Star on GitHub</a>
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
		<AccountCorner account={account} status={status} />
		</>
	)
}

/** Who you are, top right: an invitation to sign up, a way back to your boards, or your plan. */
function AccountCorner({ account, status }: { account?: Props['account']; status: TutorStatus }) {
	const stop = (e: React.PointerEvent) => e.stopPropagation()
	if (account) return (
		<nav className="loci-corner" aria-label="Account" onPointerDown={stop}>
			{account.pro && <span className="loci-corner__badge">Pro</span>}
			<a href="/account">Account</a>
		</nav>
	)
	if (!status.accounts) return null
	if (status.signedIn) return (
		<nav className="loci-corner" aria-label="Account" onPointerDown={stop}>
			<a href="/home">Your boards</a>
			<a href="/account">{status.pro ? 'Pro · Account' : 'Account'}</a>
		</nav>
	)
	return (
		<nav className="loci-corner" aria-label="Account" onPointerDown={stop}>
			{/* Google sign-in signs in or creates the account in one step, so one button covers both. */}
			<a className="loci-corner__cta" href="/account">Get started</a>
		</nav>
	)
}
