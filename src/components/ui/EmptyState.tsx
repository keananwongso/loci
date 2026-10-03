'use client'
import { useEditor, useValue } from 'tldraw'
import { UploadIcon } from './icons'

export function EmptyState({ onUpload, onSample, loading }: { onUpload: () => void; onSample: () => void; loading?: string | null }) {
	const editor = useEditor()
	const empty = useValue('empty', () => editor.getCurrentPageShapeIds().size === 0, [editor])
	if (!empty && !loading) return null
	return (
		<div className="loci-empty">
			<div className="loci-empty__inner" onPointerDown={(e) => e.stopPropagation()}>
				<div className="loci-sphere" aria-hidden />
				<span className="loci-badge">Runs locally · files stay on this machine</span>
				<h1 className="loci-empty__title">
					Learn right
					<br />
					on the page.
				</h1>
				<p className="loci-empty__lede">
					<mark>Drop in your lecture notes</mark> or a screenshot, select what confuses you, and ask. Loci explains by drawing
					right beside your material: highlights, diagrams, equations.
				</p>
				{loading ? (
					<p className="loci-empty__loading">{loading}</p>
				) : (
					<div className="loci-empty__actions">
						<button className="loci-primary" onClick={onUpload}>
							<UploadIcon /> Upload notes
						</button>
						<button className="loci-secondary" onClick={onSample}>
							Try sample calculus notes
						</button>
					</div>
				)}
				<p className="loci-empty__fine">PDF, PNG or JPG · drag and drop or paste works too</p>
			</div>
		</div>
	)
}
