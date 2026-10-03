'use client'
import type { Editor, TLShape } from 'tldraw'
import type { AckKind } from '@/lib/voice/ack'
import type { BuddyThought } from '@/lib/canvas/presence'
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

/** Which acknowledgement fits what the student is pointing at. */
export function ackKindFor(editor: Editor): AckKind {
	const selected = editor.getSelectedShapes()
	if (selected.length === 0) return 'none'
	if (selected.some((s) => s.type === REGION || s.type === MATERIAL)) return 'part'
	if (selected.length === 1 && selected[0].type === GRAPH) return 'graph'
	return 'object'
}

/** The tutor's first thought, before the model has said anything: what it is looking at. */
export function firstThought(editor: Editor): BuddyThought {
	const selected = editor.getSelectedShapes()
	if (selected.length === 0) return { text: 'looking at your board' }
	const region = selected.find((s) => s.type === REGION)
	if (region) {
		const page = editor
			.getCurrentPageShapes()
			.find((s) => s.type === MATERIAL && editor.getShapePageBounds(s)?.collides(editor.getShapePageBounds(region)!))
		return { text: page ? `reading this part of ${nameOf(page)}` : 'looking at this part' }
	}
	if (selected.length > 1) return { text: `looking at these ${selected.length} things` }
	const s = selected[0]
	switch (s.type) {
		case MATERIAL:
			return { text: `reading ${nameOf(s)}` }
		case GRAPH:
			return { text: 'looking at your graph' }
		case EQUATION:
			return { text: 'reading your equation' }
		case 'draw':
			return { text: 'looking at your sketch' }
		default:
			return { text: 'looking at this' }
	}
}
