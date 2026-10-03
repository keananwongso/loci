'use client'
import { Vec, type Editor, type StateNode, type TLPointerEventInfo } from 'tldraw'

/**
 * Dragging on empty board space pans the whiteboard, like a map. Shift or Cmd/Ctrl + drag still
 * draws a selection box, and a plain click on empty space still clears the selection.
 *
 * tldraw has no option for this, so the select tool's "pointing on canvas" state is extended in
 * place: its own behaviour runs unless the press turns into a plain drag.
 */
export function installDragToPan(editor: Editor) {
	const state = editor.getStateDescendant<StateNode>('select.pointing_canvas')
	if (!state) return
	type Handler = ((info: TLPointerEventInfo) => void) | undefined
	const s = state as unknown as Record<'onEnter' | 'onPointerMove' | 'onPointerUp', Handler>
	const enter = s.onEnter?.bind(state)
	const move = s.onPointerMove?.bind(state)
	const up = s.onPointerUp?.bind(state)

	let camera = new Vec()
	let mode: 'press' | 'pan' | 'brush' = 'press'
	let pressInfo: TLPointerEventInfo | null = null

	s.onEnter = (info) => {
		camera = Vec.From(editor.getCamera())
		pressInfo = info
		mode = info.shiftKey || info.accelKey ? 'brush' : 'press'
		// Box selection keeps tldraw's behaviour; otherwise wait to see if this is a click or a pan.
		if (mode === 'brush') enter?.(info)
	}
	s.onPointerMove = (info) => {
		if (mode === 'brush') return move?.(info)
		if (!editor.inputs.getIsDragging()) return
		mode = 'pan'
		const delta = Vec.Sub(editor.inputs.getCurrentScreenPoint(), editor.inputs.getOriginScreenPoint()).div(editor.getZoomLevel())
		editor.setCamera(camera.clone().add(delta))
	}
	s.onPointerUp = (info) => {
		if (mode === 'pan') {
			const v = editor.inputs.getPointerVelocity()
			const speed = Math.min(v.len(), 2)
			if (speed > 0.1) editor.slideCamera({ speed, direction: { x: v.x, y: v.y, z: 0 } })
			state.parent?.transition('idle')
			return
		}
		// A click on empty space: tldraw's own logic (deselect, or select what's under the pointer).
		if (mode === 'press' && pressInfo) enter?.(pressInfo)
		up?.(info)
	}
}
