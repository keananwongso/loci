'use client'
import { REPO_URL } from './KeyDialog'

/** On the hosted demo, which only teaches from its own notes: where to go to use yours. */
export function OwnNotes({ onClose }: { onClose: () => void }) {
	return (
		<div className="loci-modal" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
			<div className="loci-modal__card" onPointerDown={(e) => e.stopPropagation()}>
				<h2>Want it on your own notes?</h2>
				<p className="loci-modal__lede">
					This demo only teaches from its sample notes. Loci is free and open source: run it on your own machine and drop in your lecture
					notes, syllabus or mark scheme. Your files never leave your computer.
				</p>
				<div className="loci-modal__actions">
					<a className="loci-primary" href={REPO_URL} target="_blank" rel="noreferrer">
						★ Star on GitHub
					</a>
					<a className="loci-secondary" href={`${REPO_URL}#local-setup`} target="_blank" rel="noreferrer">
						How to run it
					</a>
				</div>
				<button className="loci-coach__skip loci-modal__close" onClick={onClose}>
					Keep exploring the demo
				</button>
			</div>
		</div>
	)
}
