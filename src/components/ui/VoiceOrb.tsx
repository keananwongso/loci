'use client'
import { useEffect, useRef, useState } from 'react'
import { loadOrbScript, registerOrb, type SpeakingOrbElement } from '@/lib/voice/orb'
import { checkSpeechProvider } from '@/lib/voice/player'
import { CloseIcon } from './icons'

/**
 * Voice mode presence: the Ship Notes speaking orb on a dark tile. It listens while the student
 * holds to talk, thinks while the tutor works, and speaks each sentence with live captions.
 */
export function VoiceOrb({ onClose }: { onClose: () => void }) {
	const host = useRef<HTMLDivElement>(null)
	const [ready, setReady] = useState(false)
	const [provider, setProvider] = useState<'fish' | 'browser' | null>(null)

	useEffect(() => {
		let live = true
		loadOrbScript()
			.then(() => live && setReady(true))
			.catch((err) => console.warn('[loci]', err))
		checkSpeechProvider().then((p) => live && setProvider(p))
		return () => {
			live = false
		}
	}, [])

	// Created imperatively: React 19 would set these as properties, and the orb exposes them as
	// read-only getters backed by attributes.
	useEffect(() => {
		if (!ready || !host.current) return
		const orb = document.createElement('speaking-orb') as SpeakingOrbElement
		for (const [k, v] of Object.entries({ state: 'listening', rest: 'listening', level: '0.12', particles: '2600', class: 'loci-voice__orb' })) {
			orb.setAttribute(k, v)
		}
		host.current.appendChild(orb)
		registerOrb(orb)
		return () => {
			registerOrb(null)
			orb.remove()
		}
	}, [ready])

	return (
		<div className="loci-voice" onPointerDown={(e) => e.stopPropagation()}>
			<div className="loci-voice__head">
				<span>{provider === 'fish' ? 'Voice · Fish Audio' : provider === 'browser' ? 'Voice · browser' : 'Voice'}</span>
				<button className="loci-voice__close" onClick={onClose} title="Turn voice off" aria-label="Turn voice off">
					<CloseIcon />
				</button>
			</div>
			<div ref={host} />
		</div>
	)
}
