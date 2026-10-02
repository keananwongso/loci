'use client'
import type { Editor, TLShape } from 'tldraw'
import { EQUATION, GRAPH, HIGHLIGHT, MATERIAL, REGION, type MaterialShape } from '@/lib/canvas/shape-types'

function nameOf(s: TLShape): string {
	switch (s.type) {
		case MATERIAL: {
			const p = (s as MaterialShape).props
			return p.kind === 'pdf' ? `${p.name} · p. ${p.page}` : p.name
		}
		case REGION:
			return 'Selected area'
		case EQUATION:
			return 'Equation'
		case GRAPH:
			return 'Diagram'
		case HIGHLIGHT:
			return 'Highlight'
		case 'text':
			return 'Text'
		case 'draw':
			return 'Sketch'
		case 'arrow':
			return 'Arrow'
		default:
			return 'Shape'
	}
}

/** Short label for what the student is pointing at ("notes.pdf · p. 2", "Selected area"). */
export function describeSelection(editor: Editor): string {
	const selected = editor.getSelectedShapes()
	if (selected.length === 0) return 'Current view'
	const region = selected.find((s) => s.type === REGION)
	if (region) {
		const page = editor
			.getCurrentPageShapes()
			.find((s) => s.type === MATERIAL && editor.getShapePageBounds(s)?.collides(editor.getShapePageBounds(region)!))
		return page ? `Area on ${nameOf(page)}` : 'Selected area'
	}
	if (selected.length === 1) return nameOf(selected[0])
	return `${selected.length} objects`
}
