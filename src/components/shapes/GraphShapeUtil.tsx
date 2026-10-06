'use client'
import {
	HTMLContainer,
	Rectangle2d,
	ShapeUtil,
	resizeBox,
	type TLResizeInfo,
} from '@/lib/whiteboard'
import { GRAPH, type GraphShape } from '@/lib/canvas/shape-types'
import { layoutGraph, type GraphLayout } from '@/lib/canvas/graph-layout'
import { latexToPlain, renderLatex } from '@/lib/canvas/katex'
import { consumeFresh } from '@/lib/canvas/fresh'

function Strokes({ layout, freshIds, clipId }: { layout: GraphLayout; freshIds: Set<string>; clipId?: string }) {
	return (
		<>
			{layout.grid && <path d={layout.grid} stroke="#ebe8e4" strokeWidth={1} fill="none" />}
			{layout.axes.map((s) => (
				<path key={s.key} d={s.d} stroke={s.fill ? 'none' : s.color} strokeWidth={s.width} fill={s.fill ?? 'none'} />
			))}
			{layout.tickLabels.map((t, i) => (
				<text key={i} x={t.x} y={t.y} textAnchor={t.anchor} className="loci-graph__tick">
					{t.text}
				</text>
			))}
			<g clipPath={clipId ? `url(#${clipId})` : undefined}>
				{layout.strokes.map((s) => {
					const fresh = s.itemId ? freshIds.has(s.itemId) : false
					const cls = fresh ? (s.late || s.fill ? 'loci-fade-late' : 'loci-draw') : undefined
					return (
						<path
							key={s.key}
							d={s.d}
							stroke={s.fill ? 'none' : s.color}
							strokeWidth={s.width}
							strokeDasharray={s.dashed ? '6 5' : undefined}
							strokeLinecap="round"
							strokeLinejoin="round"
							fill={s.fill ?? 'none'}
							opacity={s.opacity}
							pathLength={cls === 'loci-draw' && !s.dashed ? 1 : undefined}
							className={s.dashed && cls === 'loci-draw' ? 'loci-fade' : cls}
						/>
					)
				})}
			</g>
		</>
	)
}

function GraphView({ shape }: { shape: GraphShape }) {
	const p = shape.props
	const layout = layoutGraph(p)
	const freshIds = new Set(p.items.filter((it) => consumeFresh(`${shape.id}:${it.id}`)).map((it) => it.id))
	const clipId = `clip-${shape.id.replace(/[^a-zA-Z0-9_-]/g, '')}`
	return (
		<HTMLContainer className="loci-graph loci-hand">
			{p.title && <div className="loci-graph__title">{p.title}</div>}
			<svg width={p.w} height={p.h} className="loci-graph__svg">
				<defs>
					<clipPath id={clipId}>
						<rect x={-3} y={-3} width={p.w + 6} height={p.h + 6} />
					</clipPath>
				</defs>
				<Strokes layout={layout} freshIds={freshIds} clipId={clipId} />
			</svg>
			{layout.labels.map((l) => (
				<div
					key={l.key}
					className={l.itemId && freshIds.has(l.itemId) ? 'loci-graph__label loci-fade-late' : 'loci-graph__label'}
					style={{ left: l.x, top: l.y, color: l.color, fontSize: l.size ?? 17 }}
					dangerouslySetInnerHTML={{ __html: renderLatex(l.latex, false) }}
				/>
			))}
		</HTMLContainer>
	)
}

/** A coordinate plane. Its items (vectors, curves, angles...) are stored in math coordinates. */
export class GraphShapeUtil extends ShapeUtil<GraphShape> {
	static override type = GRAPH

	getDefaultProps(): GraphShape['props'] {
		return { w: 400, h: 400, xMin: -5, xMax: 5, yMin: -5, yMax: 5, grid: true, xLabel: 'x', yLabel: 'y', title: '', items: [] }
	}

	override isAspectRatioLocked() {
		return true
	}

	getGeometry(shape: GraphShape) {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	override onResize(shape: GraphShape, info: TLResizeInfo<GraphShape>) {
		return resizeBox(shape, info)
	}

	component(shape: GraphShape) {
		return <GraphView shape={shape} />
	}

	getIndicatorPath(shape: GraphShape) {
		const path = new Path2D()
		path.rect(0, 0, shape.props.w, shape.props.h)
		return path
	}

	override getText(shape: GraphShape) {
		return shape.props.title || undefined
	}

	override toSvg(shape: GraphShape) {
		const layout = layoutGraph(shape.props)
		return (
			<g>
				<style>{'.loci-graph__tick{font:10px sans-serif;fill:#a59f97}'}</style>
				<Strokes layout={layout} freshIds={new Set()} />
				{layout.labels.map((l) => (
					<text key={l.key} x={l.x} y={l.y} fill={l.color} fontSize={15} fontStyle="italic" fontFamily="serif" textAnchor="middle" dominantBaseline="middle">
						{latexToPlain(l.latex)}
					</text>
				))}
			</g>
		)
	}
}
