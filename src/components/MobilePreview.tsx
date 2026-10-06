'use client'
import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { BrandLogo } from './ui/BrandLogo'

const MOBILE_QUERY = '(max-width: 767px), (hover: none) and (pointer: coarse)'
const subscribe = (notify: () => void) => {
	const media = window.matchMedia(MOBILE_QUERY)
	media.addEventListener('change', notify)
	return () => media.removeEventListener('change', notify)
}
const snapshot = () => window.matchMedia(MOBILE_QUERY).matches
const serverSnapshot = () => null

/** Check the device before mounting the canvas or starting a demo. */
export function MobilePreview({ children }: { children: ReactNode }) {
	const pathname = usePathname()
	const mobile = useSyncExternalStore(subscribe, snapshot, serverSnapshot)
	const [copied, setCopied] = useState(false)
	const [fallbackLink, setFallbackLink] = useState('')
	const preview = pathname === '/' || pathname === '/demo' || pathname === '/home' || pathname.startsWith('/board/')
	if (!preview || mobile === false) return children

	const copy = async () => {
		// Keep saved-board links, but avoid automatically starting the demo tour.
		const url = new URL(window.location.href)
		url.searchParams.delete('lesson')
		try {
			await navigator.clipboard.writeText(url.href)
			setCopied(true)
			setFallbackLink('')
		} catch {
			setFallbackLink(url.href)
		}
	}

	return <main className="loci-mobile-preview">
		<a className="loci-brand" href="/" aria-label="Loci home"><BrandLogo /></a>
		{mobile !== null && <>
			<section className="loci-mobile-preview__intro">
				<div className="loci-sphere" aria-hidden />
				<p className="loci-mobile-preview__eyebrow">A spatial canvas for learning</p>
				<h1>Intelligence,<br />given a place.</h1>
				<p>Bring your notes. Loci draws, writes and explains beside them, so every answer stays where you asked it.</p>
			</section>
			<section className="loci-mobile-preview__notice" aria-labelledby="loci-mobile-heading">
				<h2 id="loci-mobile-heading">Try Loci on your computer.</h2>
				<p>Mobile isn’t supported yet. Open learnwithloci.com on your laptop or desktop to get started.</p>
				<button className="loci-primary" onClick={copy}>Copy link</button>
				<p className="loci-mobile-preview__status" role="status">{copied ? 'Link copied. Open it on your computer.' : fallbackLink ? 'Copy the link below to open it on your computer.' : ''}</p>
				{fallbackLink && <input className="loci-mobile-preview__link" aria-label="Link to open on your computer" readOnly value={fallbackLink} onFocus={e => e.currentTarget.select()} />}
			</section>
		</>}
	</main>
}
