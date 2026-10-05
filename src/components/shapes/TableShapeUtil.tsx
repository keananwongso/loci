'use client'
import { useRef } from 'react'
import { HTMLContainer, Rectangle2d, ShapeUtil, T, stopEventPropagation, useEditor, useValue, type RecordProps } from 'tldraw'
import { TABLE, type TableShape } from '@/lib/canvas/shape-types'
import { CELL_MAX } from '@/lib/actions/schema'
import { INK, inkHex } from '@/lib/canvas/palette'
import { consumeFresh } from '@/lib/canvas/fresh'
import { CELL_PAD, ROW_H, TABLE_FONT, cellRect, columnWidths, gridPaths, nextCell, tableSize } from '@/lib/canvas/table'

function Ruling({ shape }: { shape: TableShape }) {
	const { colW, cells, color, w } = shape.props
	const ink = inkHex(color, 'blue')
	const grid = gridPaths(colW, cells.length, shape.id)
	return (
		<>
			<rect width={w} height={ROW_H} fill={ink} opacity={0.06} />
			<path d={grid.light} stroke={ink} strokeWidth={1.3} strokeLinecap="round" fill="none" opacity={0.55} />
			<path d={grid.heavy} stroke={ink} strokeWidth={2} strokeLinecap="round" fill="none" />
		</>
	)
}

function TableView({ shape }: { shape: TableShape }) {
	const editor = useEditor()
	const { columns, cells, colW, minW, color, w, h } = shape.props
	const readonly = useValue('table-readonly', () => editor.getIsReadonly(), [editor])
	const inputs = useRef(new Map<string, HTMLInputElement>())

	const type = (r: number, c: number, text: string) => {
		const next = cells.map((row) => [...row])
		next[r][c] = { text, by: 'student' }
		const widths = columnWidths(columns, next, minW)
		editor.updateShape<TableShape>({ id: shape.id, type: TABLE, props: { cells: next, colW: widths, ...tableSize(widths, next.length) } })
	}

	const go = (to: [number, number] | null, from: HTMLInputElement) => {
		const el = to && inputs.current.get(`${to[0]}:${to[1]}`)
		if (el) el.focus()
		else from.blur()
	}

	return (
		<HTMLContainer className="loci-table" style={{ width: w, height: h, color: inkHex(color, 'blue') }}>
			<svg className="loci-table__lines" width={w} height={h}>
				<Ruling shape={shape} />
			</svg>
			{[columns.map((text) => ({ text, by: 'tutor' as const })), ...cells].map((row, i) => (
				<div key={i} className="loci-table__row" data-write-line="" style={{ height: ROW_H }}>
					{row.map((cell, c) => {
						const r = i - 1
						const style = { width: colW[c], padding: `0 ${CELL_PAD}px` }
						if (cell.by === 'tutor' || readonly) {
							const fresh = r >= 0 && consumeFresh(`${shape.id}:${r}:${c}`)
							return (
								<div key={c} className={fresh ? 'loci-table__cell loci-table__fresh' : 'loci-table__cell'} style={style}>
									{cell.text}
								</div>
							)
						}
						return (
							<input
								key={c}
								ref={(el) => {
									if (el) inputs.current.set(`${r}:${c}`, el)
									else inputs.current.delete(`${r}:${c}`)
								}}
								className="loci-table__input"
								style={{ ...style, color: INK.ink }}
								value={cell.text}
								placeholder=" "
								maxLength={CELL_MAX}
								spellCheck={false}
								autoComplete="off"
								aria-label={`${columns[c] || `column ${c + 1}`}, row ${r + 1}`}
								onPointerDown={stopEventPropagation}
								onChange={(e) => type(r, c, e.currentTarget.value)}
								onKeyDown={(e) => {
									e.stopPropagation()
									if (e.key === 'Tab') {
										e.preventDefault()
										go(nextCell(cells, r, c, e.shiftKey ? -1 : 1), e.currentTarget)
									} else if (e.key === 'Enter') {
										e.preventDefault()
										go(nextCell(cells, r, c, 1, true), e.currentTarget)
									} else if (e.key === 'Escape') e.currentTarget.blur()
								}}
							/>
						)
					})}
				</div>
			))}
		</HTMLContainer>
	)
}

/** A ruled table the tutor draws; its blank cells are inputs the student types into. */
export class TableShapeUtil extends ShapeUtil<TableShape> {
	static override type = TABLE
	static override props: RecordProps<TableShape> = {
		w: T.number,
		h: T.number,
		columns: T.arrayOf(T.string),
		cells: T.arrayOf(T.jsonValue) as never,
		color: T.string,
		minW: T.arrayOf(T.number),
		colW: T.arrayOf(T.number),
	}

	getDefaultProps(): TableShape['props'] {
		return { w: 120, h: ROW_H * 2, columns: [''], cells: [[{ text: '', by: 'student' }]], color: 'blue', minW: [], colW: [120] }
	}

	override canResize() {
		return false
	}

	override hideRotateHandle() {
		return true
	}

	getGeometry(shape: TableShape) {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	component(shape: TableShape) {
		return <TableView shape={shape} />
	}

	getIndicatorPath(shape: TableShape) {
		const path = new Path2D()
		path.rect(0, 0, shape.props.w, shape.props.h)
		return path
	}

	override getText(shape: TableShape) {
		return [shape.props.columns, ...shape.props.cells.map((row) => row.map((c) => c.text))].map((row) => row.join(' ')).join('\n')
	}

	override toSvg(shape: TableShape) {
		const { columns, cells, colW, color } = shape.props
		const ink = inkHex(color, 'blue')
		const label = (text: string, row: number, col: number, student: boolean) => {
			const r = cellRect(colW, row, col)
			return (
				<text
					key={`${row}:${col}`}
					x={r.x + r.w / 2}
					y={r.y + r.h / 2}
					textAnchor="middle"
					dominantBaseline="middle"
					fontSize={TABLE_FONT * (student ? 0.85 : 1)}
					fontFamily={student ? 'sans-serif' : "'loci-hand', 'Shantell Sans', sans-serif"}
					fill={student ? INK.ink : ink}
				>
					{text}
				</text>
			)
		}
		return (
			<g>
				<Ruling shape={shape} />
				{columns.map((t, c) => label(t, -1, c, false))}
				{cells.flatMap((row, r) => row.map((cell, c) => (cell.text ? label(cell.text, r, c, cell.by === 'student') : null)))}
			</g>
		)
	}
}
