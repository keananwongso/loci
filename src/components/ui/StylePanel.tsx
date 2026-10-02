'use client'
import { DefaultStylePanel, useEditor, useValue, type TLUiStylePanelProps } from 'tldraw'

const NATIVE = new Set(['draw', 'geo', 'text', 'arrow', 'note', 'line', 'highlight'])

/** tldraw's style panel, shown only while drawing or editing the student's own sketches. */
export function StylePanel(props: TLUiStylePanelProps) {
	const editor = useEditor()
	const show = useValue(
		'show-style-panel',
		() => {
			if (NATIVE.has(editor.getCurrentToolId())) return true
			const selected = editor.getSelectedShapes()
			return selected.length > 0 && selected.every((s) => NATIVE.has(s.type))
		},
		[editor]
	)
	return show ? <DefaultStylePanel {...props} /> : null
}
