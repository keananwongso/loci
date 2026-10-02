'use client'
import { HTMLContainer, Rectangle2d, ShapeUtil, T, resizeBox, type RecordProps, type TLResizeInfo } from 'tldraw'
import { HIGHLIGHT, type HighlightShape } from '@/lib/canvas/shape-types'
import { HIGHLIGHT_FILL, HIGHLIGHT_STROKE } from '@/lib/canvas/palette'
import { consumeFresh } from '@/lib/canvas/fresh'

/** A slightly irregular hand-drawn ellipse, like a tutor circling a symbol with a pen. */
function ringPath(w: number, h: number) {
	const cx = w / 2
	const cy = h / 2
	const rx = w / 2 + 6
	const ry = h / 2 + 5
	const pts: string[] = []
	const turns = 1.08
	for (let i = 0; i <= 64; i++) {
		const t = (i / 64) * Math.PI * 2 * turns - Math.PI * 0.6
		const wobble = 1 + 0.035 * Math.sin(t * 3 + 1) + (i / 64) * 0.05
		pts.push(`${(cx + Math.cos(t) * rx * wobble).toFixed(1)},${(cy + Math.sin(t) * ry * wobble).toFixed(1)}`)
	}
	return `M${pts.join(' L')}`
}

function HighlightView({ shape }: { shape: HighlightShape }) {
	const { w, h, style, color } = shape.props
	const animate = consumeFresh(shape.id)
	const stroke = HIGHLIGHT_STROKE[color]
	if (style === 'marker') {
		return (
			<HTMLContainer>
				<div
					className={animate ? 'loci-marker loci-wipe' : 'loci-marker'}
					style={{ width: w, height: h, background: HIGHLIGHT_FILL[color] }}
				/>
			</HTMLContainer>
		)
	}
	if (style === 'box') {
		return (
			<HTMLContainer>
				<div className={animate ? 'loci-pop' : undefined} style={{ width: w, height: h, border: `2px solid ${stroke}`, borderRadius: 6 }} />
			</HTMLContainer>
		)
	}
	const d = style === 'circle' ? ringPath(w, h) : `M -2 ${h + 2} Q ${w * 0.3} ${h + 5}, ${w * 0.55} ${h + 2.5} T ${w + 2} ${h + 2}`
	return (
		<HTMLContainer style={{ overflow: 'visible' }}>
			<svg width={w} height={h} style={{ overflow: 'visible', position: 'absolute', inset: 0 }}>
				<path
					d={d}
					fill="none"
					stroke={stroke}
					strokeWidth={2.6}
					strokeLinecap="round"
					strokeLinejoin="round"
					pathLength={1}
					className={animate ? 'loci-draw' : undefined}
				/>
			</svg>
		</HTMLContainer>
	)
}

/** A tutor mark on part of the student's material. Lives inside the material shape, so it moves and scales with it. */
export class HighlightShapeUtil extends ShapeUtil<HighlightShape> {
	static override type = HIGHLIGHT
	static override props: RecordProps<HighlightShape> = {
		w: T.number,
		h: T.number,
		style: T.literalEnum('marker', 'box', 'circle', 'underline'),
		color: T.literalEnum('yellow', 'green', 'blue', 'pink'),
	}

	getDefaultProps(): HighlightShape['props'] {
		return { w: 100, h: 24, style: 'marker', color: 'yellow' }
	}

	getGeometry(shape: HighlightShape) {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: shape.props.style === 'marker' })
	}

	override onResize(shape: HighlightShape, info: TLResizeInfo<HighlightShape>) {
		return resizeBox(shape, info)
	}

	override hideRotateHandle() {
		return true
	}

	component(shape: HighlightShape) {
		return <HighlightView shape={shape} />
	}

	getIndicatorPath(shape: HighlightShape) {
		const path = new Path2D()
		path.rect(0, 0, shape.props.w, shape.props.h)
		return path
	}

	override toSvg(shape: HighlightShape) {
		const { w, h, style, color } = shape.props
		if (style === 'marker') return <rect width={w} height={h} rx={3} fill={HIGHLIGHT_FILL[color]} />
		if (style === 'box') return <rect width={w} height={h} rx={6} fill="none" stroke={HIGHLIGHT_STROKE[color]} strokeWidth={2} />
		if (style === 'circle') return <path d={ringPath(w, h)} fill="none" stroke={HIGHLIGHT_STROKE[color]} strokeWidth={2.6} />
		return <path d={`M 0 ${h + 2} L ${w} ${h + 2}`} stroke={HIGHLIGHT_STROKE[color]} strokeWidth={2.6} />
	}
}
