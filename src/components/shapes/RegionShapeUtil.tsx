'use client'
import { BaseBoxShapeTool, HTMLContainer, Rectangle2d, ShapeUtil, T, resizeBox, type RecordProps, type TLResizeInfo } from 'tldraw'
import { REGION, type RegionShape } from '@/lib/canvas/shape-types'

/** A dashed box the student drags around part of their material to ask about just that area. */
export class RegionShapeUtil extends ShapeUtil<RegionShape> {
	static override type = REGION
	static override props: RecordProps<RegionShape> = { w: T.number, h: T.number }

	getDefaultProps(): RegionShape['props'] {
		return { w: 200, h: 120 }
	}

	getGeometry(shape: RegionShape) {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: false })
	}

	override onResize(shape: RegionShape, info: TLResizeInfo<RegionShape>) {
		return resizeBox(shape, info)
	}

	override hideRotateHandle() {
		return true
	}

	component(shape: RegionShape) {
		return (
			<HTMLContainer className="loci-region" style={{ width: shape.props.w, height: shape.props.h }}>
				<span className="loci-region__tag">Asking about this area</span>
			</HTMLContainer>
		)
	}

	getIndicatorPath(shape: RegionShape) {
		const path = new Path2D()
		path.rect(0, 0, shape.props.w, shape.props.h)
		return path
	}

	override toSvg(shape: RegionShape) {
		return <rect width={shape.props.w} height={shape.props.h} fill="none" stroke="#2457e6" strokeWidth={2} strokeDasharray="6 5" rx={6} />
	}
}

/** Drag to draw a region; then select it and ask. Shortcut: Q. */
export class RegionTool extends BaseBoxShapeTool {
	static override id = 'loci-region'
	static override initial = 'idle'
	override shapeType = REGION as typeof REGION

	override onCreate() {
		// Return to selection (select.idle also clears the tool-id mask tldraw sets while the
		// box is being dragged) so the region stays selected and the student can type.
		this.editor.setCurrentTool('select.idle')
		window.dispatchEvent(new CustomEvent('loci:focus-prompt'))
	}
}
