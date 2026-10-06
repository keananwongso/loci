'use client'
import { useEditor, useValue } from '@/lib/whiteboard'
const NATIVE = new Set([
	'draw',
	'geo',
	'text',
	'arrow',
	'note',
	'line',
	'highlight'
])
/** Styles for student ink, implemented with Loci's document controller. */
export function StylePanel() {
	const editor = useEditor()
	const selected = useValue('styles', () => editor.getSelectedShapes())
	const tool = useValue('style-tool', () => editor.getCurrentToolId())
	if (
		!NATIVE.has(tool) &&
		(!selected.length || !selected.every((s) => NATIVE.has(s.type)))
	)
		return null
	const style = { ...editor.styles, ...selected[0]?.props }
	const change = (key: string, value: string) => {
		editor.setStyleForNextShapes(key, value)
		editor.markHistoryStoppingPoint('style')
		editor.run(() =>
			selected.forEach((s) =>
				editor.updateShape({ id: s.id, props: { [key]: value } })
			)
		)
	}
	return (
		<aside
			className="loci-styles"
			aria-label="Drawing style"
			onPointerDown={(e) => e.stopPropagation()}
		>
			<label>
				Color
				<select
					aria-label="Ink color"
					value={style.color}
					onChange={(e) => change('color', e.target.value)}
				>
					{['black', 'blue', 'red', 'green', 'orange', 'violet', 'grey'].map(
						(v) => (
							<option key={v}>{v}</option>
						)
					)}
				</select>
			</label>
			<label>
				Size
				<select
					aria-label="Ink size"
					value={style.size}
					onChange={(e) => change('size', e.target.value)}
				>
					{['s', 'm', 'l', 'xl'].map((v) => (
						<option key={v}>{v}</option>
					))}
				</select>
			</label>
			<label>
				Line
				<select
					aria-label="Line style"
					value={style.dash}
					onChange={(e) => change('dash', e.target.value)}
				>
					{['solid', 'dashed', 'dotted'].map((v) => (
						<option key={v}>{v}</option>
					))}
				</select>
			</label>
			<label>
				Font
				<select
					aria-label="Text font"
					value={style.font}
					onChange={(e) => change('font', e.target.value)}
				>
					{['draw', 'sans', 'serif', 'mono'].map((v) => (
						<option key={v}>{v}</option>
					))}
				</select>
			</label>
			{(tool === 'geo' || selected.some((s) => s.type === 'geo')) && (
				<>
					<label>
						Fill
						<select
							aria-label="Shape fill"
							value={style.fill ?? 'none'}
							onChange={(e) => change('fill', e.target.value)}
						>
							{['none', 'semi', 'solid'].map((v) => (
								<option key={v}>{v}</option>
							))}
						</select>
					</label>
					<label>
						Shape
						<select
							aria-label="Shape type"
							value={style.geo ?? 'rectangle'}
							onChange={(e) => change('geo', e.target.value)}
						>
							{['rectangle', 'ellipse', 'triangle', 'diamond'].map((v) => (
								<option key={v}>{v}</option>
							))}
						</select>
					</label>
				</>
			)}
		</aside>
	)
}
