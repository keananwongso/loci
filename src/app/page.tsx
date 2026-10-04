'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { REPO_URL } from '@/components/ui/KeyDialog'

export default function Page() {
	const [preview, setPreview] = useState(false)
	const dialog = useRef<HTMLDialogElement>(null)
	useEffect(() => {
		if (preview) dialog.current?.showModal()
		else dialog.current?.close()
	}, [preview])
	return (
		<main className="loci-landing">
			<nav className="loci-landing__nav">
				<a className="loci-brand" href="/">
					Loci
				</a>
				<a href={REPO_URL} target="_blank" rel="noreferrer">
					Open source ↗
				</a>
			</nav>
			<section className="loci-landing__hero">
				<div className="loci-sphere" aria-hidden />
				<p className="loci-landing__eyebrow">An open-source spatial AI tutor</p>
				<h1>
					See the idea.
					<br />
					Understand the math.
				</h1>
				<p className="loci-landing__lede">
					Your notes become a shared whiteboard. Loci explains by drawing graphs, writing equations, and talking you through them.
				</p>
				<div className="loci-landing__actions">
					<a className="loci-primary" href={REPO_URL} target="_blank" rel="noreferrer">
						★ Star on GitHub
					</a>
					<button className="loci-secondary" onClick={() => setPreview(true)}>
						See how Loci works ↗
					</button>
				</div>
				<p className="loci-landing__fine">Try the live demo. No account needed.</p>
				<div className="loci-landing__board" aria-label="Illustration of Loci drawing a gradient beside calculus notes">
					<div className="loci-landing__notes">
						<span>YOUR NOTES</span>
						<h2>Meet the gradient.</h2>
						<p>Partial derivatives measure change along each axis.</p>
						<div>∇f = (fₓ, fᵧ)</div>
						<p>Together, they point uphill.</p>
					</div>
					<svg viewBox="0 0 360 210" role="img" aria-label="A gradient vector with its horizontal and vertical components">
						<defs>
							<marker id="tip" markerWidth="8" markerHeight="8" refX="5" refY="3" orient="auto">
								<path d="M0,0 L0,6 L6,3 z" fill="#7445e0" />
							</marker>
						</defs>
						<path d="M40 175H330M65 195V20" stroke="#a59f97" fill="none" />
						<path d="M65 175H235V65" stroke="#a59f97" strokeDasharray="5 6" fill="none" />
						<path d="M65 175L235 65" stroke="#7445e0" strokeWidth="3" markerEnd="url(#tip)" />
						<g fill="#44403b" fontSize="15">
							<text x="144" y="198">
								fₓ
							</text>
							<text x="248" y="128">
								fᵧ
							</text>
							<text x="140" y="55" fill="#7445e0">
								the gradient
							</text>
							<text x="320" y="196">
								x
							</text>
							<text x="44" y="25">
								y
							</text>
						</g>
					</svg>
				</div>
			</section>
			<footer className="loci-landing__footer">
				<span>
					Built by{' '}
					<a href="https://keananwongso.com" target="_blank" rel="noreferrer">
						Keanan Wongso ↗
					</a>
				</span>
				<a href="https://linkedin.com/in/keananwongso" target="_blank" rel="noreferrer">
					LinkedIn ↗
				</a>
				<a href={REPO_URL} target="_blank" rel="noreferrer">
					GitHub ↗
				</a>
			</footer>
			<dialog
				ref={dialog}
				className="loci-entry"
				aria-labelledby="loci-entry-title"
				onCancel={() => setPreview(false)}
				onClick={(e) => {
					if (e.target === e.currentTarget) setPreview(false)
				}}
			>
				<p className="loci-landing__eyebrow">See how Loci works</p>
				<h2 id="loci-entry-title">
					One question.
					<br />A whiteboard full of intuition.
				</h2>
				<p>We’ve placed some calculus notes on the canvas. You’ll ask a question and watch Loci explain it live, then try a problem of your own.</p>
				<div className="loci-landing__actions">
					<Link className="loci-primary" href="/demo?lesson">
						Let’s try it →
					</Link>
					<button className="loci-secondary" onClick={() => setPreview(false)}>
						Back
					</button>
				</div>
				<p className="loci-landing__fine">Turn your sound on. Typing works too.</p>
			</dialog>
		</main>
	)
}
