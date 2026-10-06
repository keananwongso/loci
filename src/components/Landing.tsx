'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { tourDone } from './useTour'
import { REPO_URL } from '@/components/ui/KeyDialog'

export default function Landing({ accounts, billing }: { accounts: boolean; billing: boolean }) {
	const [returning, setReturning] = useState(false)
	useEffect(() => { try { setReturning(tourDone() || Boolean(localStorage.getItem('loci:workspaces:v1'))) } catch {} }, [])
	return (
		<main className="loci-landing">
			<nav className="loci-landing__nav">
				<a className="loci-brand" href="/">
					Loci
				</a>
				{accounts && <div className="loci-landing__account">
					<Link href="/account">Sign in</Link>
					<Link className="loci-landing__cta" href="/account">Create free account</Link>
				</div>}
			</nav>
			<section className="loci-landing__hero">
				<div className="loci-sphere" aria-hidden />
				<p className="loci-landing__eyebrow">A spatial canvas for learning</p>
				<h1>
					Intelligence,
					<br />
					given a place.
				</h1>
				<p className="loci-landing__lede">
					Bring notes from any course: calculus, physics, code, accounting. Loci explains on the same board, drawing, writing and talking you through it, so every answer stays where you asked it.
				</p>
				<div className="loci-landing__actions">
					<a className="loci-primary" href={REPO_URL} target="_blank" rel="noreferrer">
						★ Star on GitHub
					</a>
					<Link className="loci-secondary" href={returning ? "/demo" : "/demo?lesson"}>
						{returning ? 'Continue learning →' : 'Try Loci →'}
					</Link>
				</div>
				{billing && <p className="loci-landing__fine">Keep learning with <Link href="/account">Loci Pro · US$8/month</Link>.</p>}
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
		</main>
	)
}
