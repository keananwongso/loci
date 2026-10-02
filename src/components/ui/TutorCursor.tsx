'use client'
import { useEditor, useValue } from 'tldraw'
import { tutorPresence } from '@/lib/canvas/presence'

/** The tutor's presence on the canvas: a soft glowing pen tip that moves to where it draws. */
export function TutorCursor() {
	const editor = useEditor()
	const state = useValue('tutor-cursor', () => {
		const p = tutorPresence.get()
		const screen = editor.pageToViewport({ x: p.x, y: p.y })
		return { ...p, sx: screen.x, sy: screen.y }
	}, [editor])
	return (
		<div
			className="loci-tutor-cursor"
			data-mode={state.mode}
			data-visible={state.visible}
			style={{ transform: `translate(${state.sx}px, ${state.sy}px)` }}
			aria-hidden
		>
			<div className="loci-tutor-cursor__halo" />
			<div className="loci-tutor-cursor__dot" />
			<div className="loci-tutor-cursor__tag">Loci</div>
		</div>
	)
}
