'use client'
import { GeoShapeGeoStyle, useEditor, useValue } from 'tldraw'
import type { ReactNode } from 'react'
import { ArrowIcon, EraserIcon, HandIcon, PenIcon, RectIcon, RegionIcon, SelectIcon, TextIcon, UploadIcon } from './icons'

const TOOLS: Array<{ id: string; label: string; kbd: string; icon: ReactNode; geo?: boolean }> = [
	{ id: 'select', label: 'Select', kbd: 'V', icon: <SelectIcon /> },
	{ id: 'hand', label: 'Pan', kbd: 'H', icon: <HandIcon /> },
	{ id: 'draw', label: 'Draw', kbd: 'D', icon: <PenIcon /> },
	{ id: 'text', label: 'Text', kbd: 'T', icon: <TextIcon /> },
	{ id: 'geo', label: 'Rectangle', kbd: 'R', icon: <RectIcon />, geo: true },
	{ id: 'arrow', label: 'Arrow', kbd: 'A', icon: <ArrowIcon /> },
	{ id: 'eraser', label: 'Eraser', kbd: 'E', icon: <EraserIcon /> },
]

export function Toolbar({ onUpload }: { onUpload: () => void }) {
	const editor = useEditor()
	const current = useValue('tool', () => editor.getCurrentToolId(), [editor])
	return (
		<nav className="loci-toolbar" aria-label="Canvas tools" onPointerDown={(e) => e.stopPropagation()}>
			{TOOLS.map((t) => (
				<button
					key={t.id}
					className="loci-tool"
					data-active={current === t.id}
					title={`${t.label} (${t.kbd})`}
					aria-label={t.label}
					onClick={() => {
						if (t.geo) editor.setStyleForNextShapes(GeoShapeGeoStyle, 'rectangle')
						editor.setCurrentTool(t.id)
					}}
				>
					{t.icon}
				</button>
			))}
			<div className="loci-toolbar__sep" />
			<button
				className="loci-tool loci-tool--accent"
				data-active={current === 'loci-region'}
				title="Ask about an area (Q): drag a box around part of a page"
				aria-label="Ask about an area"
				onClick={() => editor.setCurrentTool('loci-region')}
			>
				<RegionIcon />
			</button>
			<button className="loci-tool" title="Upload pdf or image" aria-label="Upload" onClick={onUpload}>
				<UploadIcon />
			</button>
		</nav>
	)
}
