'use client'
import { useEditor, useValue } from 'tldraw'
import { emphasis } from '@/lib/canvas/presence'

/** A soft pulse around what the tutor is talking about, following the camera. */
export function Emphasis() {
	const editor = useEditor()
	const box = useValue(
		'emphasis-box',
		() => {
			const e = emphasis.get()
			if (!e) return null
			const { area } = e
			const a = editor.pageToViewport({ x: area.x, y: area.y })
			const b = editor.pageToViewport({ x: area.x + area.w, y: area.y + area.h })
			const point = area.w < 1 && area.h < 1
			const pad = point ? 17 : 10
			return { key: e.key, point, x: a.x - pad, y: a.y - pad, w: b.x - a.x + pad * 2, h: b.y - a.y + pad * 2 }
		},
		[editor]
	)
	if (!box) return null
	return (
		<div
			key={box.key}
			className="loci-emphasis"
			data-point={box.point}
			style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h }}
			aria-hidden
		/>
	)
}
