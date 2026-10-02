'use client'
import { useEditor, useValue } from 'tldraw'
import { MATERIAL, type MaterialShape } from '@/lib/canvas/shape-types'
import type { Turn } from '@/lib/storage/conversation'

const SAMPLE = 'directional-derivatives.pdf'
const QUESTIONS = [
	'I understand the equation, but what is u geometrically?',
	'Why does the answer become largest when they point in the same direction?',
]

/**
 * One-click questions for the sample notes. On the hosted demo they replay the free scripted
 * lesson; when running locally they ask the real model.
 */
export function Suggestions({ turns, busy, hosted, onAsk }: { turns: Turn[]; busy: boolean; hosted: boolean; onAsk: (q: string, opts: { scripted?: boolean }) => void }) {
	const editor = useEditor()
	const samplePage = useValue(
		'sample-page',
		() => editor.getCurrentPageShapes().find((s): s is MaterialShape => s.type === MATERIAL && (s as MaterialShape).props.name === SAMPLE),
		[editor]
	)
	const asked = new Set(turns.map((t) => t.question))
	const next = QUESTIONS.find((q) => !asked.has(q))
	if (!samplePage || !next || busy || turns.length > 2) return null
	return (
		<div className="loci-suggest" onPointerDown={(e) => e.stopPropagation()}>
			<button
				className="loci-suggest__chip"
				onClick={() => {
					editor.select(samplePage.id)
					onAsk(next, { scripted: hosted })
				}}
			>
				{next}
				{hosted && <span className="loci-suggest__tag">free demo</span>}
			</button>
		</div>
	)
}
