'use client'
import { GeoShapeGeoStyle, useEditor, useValue } from '@/lib/whiteboard'
import type { ReactNode } from 'react'
import { talkKeysLabel } from '@/lib/canvas/presence'
import { ArrowIcon, EraserIcon, HandIcon, PenIcon, RectIcon, RegionIcon, SelectIcon, TextIcon, TrashIcon, UploadIcon } from './icons'

const TOOLS: Array<{ id: string; label: string; kbd: string; tip: string; icon: ReactNode; geo?: boolean }> = [
	{ id: 'select', label: 'Select', kbd: 'V', tip: 'Click a page or object to ask about it. Drag to move things.', icon: <SelectIcon /> },
	{ id: 'hand', label: 'Pan', kbd: 'H', tip: 'Drag to move around the board. Dragging an empty spot works too.', icon: <HandIcon /> },
	{ id: 'draw', label: 'Pen', kbd: 'D', tip: 'Sketch on the board. Loci can see your sketches when you ask.', icon: <PenIcon /> },
	{ id: 'text', label: 'Text', kbd: 'T', tip: 'Click anywhere to type a note.', icon: <TextIcon /> },
	{ id: 'geo', label: 'Box', kbd: 'R', tip: 'Drag to draw a rectangle.', icon: <RectIcon />, geo: true },
	{ id: 'arrow', label: 'Arrow', kbd: 'A', tip: 'Drag from one thing to another to connect them.', icon: <ArrowIcon /> },
	{ id: 'eraser', label: 'Eraser', kbd: 'E', tip: 'Drag over marks to erase them.', icon: <EraserIcon /> },
]

/** A tooltip that appears beside the button: what it is, its key, and what it does. */
function Tip({ label, kbd, children }: { label: string; kbd?: string; children: ReactNode }) {
	return (
		<span className="loci-tip" role="tooltip">
			<span className="loci-tip__head">
				{label}
				{kbd && <kbd>{kbd}</kbd>}
			</span>
			<span className="loci-tip__body">{children}</span>
		</span>
	)
}

/** `onUpload` is left out on the hosted demo, which only teaches from its own notes. */
export function Toolbar({ onUpload }: { onUpload?: () => void }) {
	const editor = useEditor()
	const current = useValue('tool', () => editor.getCurrentToolId(), [editor])
	const canDelete = useValue('deletable selection', () => !editor.getInstanceState().isReadonly && editor.getSelectedShapes().some((shape) => !editor.isShapeOrAncestorLocked(shape)), [editor])
	return (
		<nav className="loci-toolbar" aria-label="Canvas tools" onPointerDown={(e) => e.stopPropagation()}>
			{TOOLS.map((t) => (
				<button
					key={t.id}
					className="loci-tool"
					data-active={current === t.id}
					aria-label={`${t.label} (${t.kbd})`}
					onClick={() => {
						if (t.geo) editor.setStyleForNextShapes(GeoShapeGeoStyle, 'rectangle')
						editor.setCurrentTool(t.id)
					}}
				>
					{t.icon}
					<Tip label={t.label} kbd={t.kbd}>
						{t.tip}
					</Tip>
				</button>
			))}
			<div className="loci-toolbar__sep" />
			{canDelete && <button className="loci-tool" aria-label="Delete selected drawings" onClick={() => {
				editor.markHistoryStoppingPoint('delete selected drawings')
				editor.deleteShapes(editor.getSelectedShapeIds())
				editor.focus()
			}}><TrashIcon /><Tip label="Delete selection" kbd="⌫">Remove the selected object. Undo with Ctrl/⌘ + Z.</Tip></button>}
			<button
				className="loci-tool loci-tool--accent"
				data-active={current === 'loci-region'}
				aria-label="Ask about an area (Q)"
				onClick={() => editor.setCurrentTool('loci-region')}
			>
				<RegionIcon />
				<Tip label="Ask about an area" kbd="Q">
					Drag a box around part of a page, then ask about it. Or hold {talkKeysLabel()} and drag while you talk.
				</Tip>
			</button>
			{onUpload && (
				<button className="loci-tool" aria-label="Upload a pdf or image" onClick={onUpload}>
					<UploadIcon />
					<Tip label="Upload">Add a pdf or an image of your notes. You can also drop files onto the board.</Tip>
				</button>
			)}
		</nav>
	)
}
