'use client'
import { useLayoutEffect, useRef } from 'react'
import {
	HTMLContainer,
	Rectangle2d,
	ShapeUtil,
	T,
	resizeBox,
	stopEventPropagation,
	useEditor,
	useIsEditing,
	type RecordProps,
	type TLResizeInfo,
} from 'tldraw'
import { EQUATION, type EquationShape } from '@/lib/canvas/shape-types'
import { EQUATION_FONT_SIZE, EQUATION_PAD, latexToPlain, measureLatex, renderLatex } from '@/lib/canvas/katex'
import { inkHex } from '@/lib/canvas/palette'
import { consumeFresh } from '@/lib/canvas/fresh'

function EquationView({ shape }: { shape: EquationShape }) {
	const editor = useEditor()
	const isEditing = useIsEditing(shape.id)
	const inputRef = useRef<HTMLTextAreaElement>(null)
	const { latex, color, size, w, baseW } = shape.props
	const fontSize = EQUATION_FONT_SIZE[size]
	const scale = baseW > 0 ? w / baseW : 1
	const animate = consumeFresh(shape.id)

	useLayoutEffect(() => {
		if (isEditing) inputRef.current?.select()
	}, [isEditing])

	const onChange = (next: string) => {
		const m = measureLatex(next || ' ', fontSize)
		editor.updateShape<EquationShape>({
			id: shape.id,
			type: EQUATION,
			props: { latex: next, baseW: m.w, baseH: m.h, w: m.w * scale, h: m.h * scale },
		})
	}

	return (
		<HTMLContainer className={animate ? 'loci-equation loci-pop' : 'loci-equation'} style={{ pointerEvents: isEditing ? 'all' : undefined }}>
			<div
				className="loci-equation__body loci-hand"
				style={{
					transform: `scale(${scale})`,
					color: inkHex(color),
					fontSize,
					padding: `${EQUATION_PAD.y}px ${EQUATION_PAD.x}px`,
				}}
				dangerouslySetInnerHTML={{ __html: renderLatex(latex, false) }}
			/>
			{isEditing && (
				<textarea
					ref={inputRef}
					className="loci-equation__editor"
					defaultValue={latex}
					spellCheck={false}
					onPointerDown={stopEventPropagation}
					onKeyDown={(e) => {
						e.stopPropagation()
						if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) editor.setEditingShape(null)
					}}
					onChange={(e) => onChange(e.currentTarget.value)}
				/>
			)}
		</HTMLContainer>
	)
}

/** A typeset LaTeX equation that keeps its source. Double-click to edit the LaTeX. */
export class EquationShapeUtil extends ShapeUtil<EquationShape> {
	static override type = EQUATION
	static override props: RecordProps<EquationShape> = {
		w: T.number,
		h: T.number,
		baseW: T.number,
		baseH: T.number,
		latex: T.string,
		color: T.string,
		size: T.literalEnum('s', 'm', 'l'),
	}

	getDefaultProps(): EquationShape['props'] {
		return { w: 200, h: 60, baseW: 200, baseH: 60, latex: 'x', color: 'ink', size: 'm' }
	}

	override isAspectRatioLocked() {
		return true
	}

	override canEdit() {
		return true
	}

	getGeometry(shape: EquationShape) {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	override onResize(shape: EquationShape, info: TLResizeInfo<EquationShape>) {
		return resizeBox(shape, info)
	}

	component(shape: EquationShape) {
		return <EquationView shape={shape} />
	}

	getIndicatorPath(shape: EquationShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 8)
		return path
	}

	override getText(shape: EquationShape) {
		return shape.props.latex
	}

	override toSvg(shape: EquationShape) {
		const fontSize = EQUATION_FONT_SIZE[shape.props.size] * (shape.props.w / Math.max(shape.props.baseW, 1))
		return (
			<text
				x={EQUATION_PAD.x}
				y={shape.props.h / 2}
				dominantBaseline="middle"
				fontFamily="'Times New Roman', serif"
				fontStyle="italic"
				fontSize={fontSize * 0.8}
				fill={inkHex(shape.props.color)}
			>
				{latexToPlain(shape.props.latex)}
			</text>
		)
	}
}
