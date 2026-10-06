'use client'
import { HTMLContainer, Rectangle2d, ShapeUtil, resizeBox, type TLResizeInfo } from '@/lib/whiteboard'
import { REGION, type RegionShape } from '@/lib/canvas/shape-types'

/** A dashed box the student drags around part of their material to ask about just that area. */
export class RegionShapeUtil extends ShapeUtil<RegionShape> {
	static override type = REGION

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
			// No label on the board: the prompt bar's chip already says "Area on …", and a tag here
			// covered the material right above the area.
			<HTMLContainer className="loci-region" style={{ width: shape.props.w, height: shape.props.h }} />
		)
	}

	getIndicatorPath(shape: RegionShape) {
		const path = new Path2D()
		path.rect(0, 0, shape.props.w, shape.props.h)
		return path
	}

	override toSvg(shape: RegionShape) {
		return <rect width={shape.props.w} height={shape.props.h} fill="none" stroke="#000000" strokeWidth={1.5} strokeDasharray="6 5" rx={12} />
	}
}
