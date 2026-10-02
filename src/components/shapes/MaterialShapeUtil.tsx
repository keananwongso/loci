'use client'
import { useEffect, useState } from 'react'
import {
	HTMLContainer,
	Rectangle2d,
	ShapeUtil,
	T,
	resizeBox,
	type RecordProps,
	type TLResizeInfo,
	type TLShape,
} from 'tldraw'
import { blobToDataUrl, getBlob, getBlobUrl } from '@/lib/storage/blobs'
import { HIGHLIGHT, MATERIAL, type MaterialShape } from '@/lib/canvas/shape-types'

function useBlobUrl(key: string) {
	const [url, setUrl] = useState<string>()
	useEffect(() => {
		let live = true
		getBlobUrl(key).then((u) => live && setUrl(u))
		return () => {
			live = false
		}
	}, [key])
	return url
}

function MaterialView({ shape }: { shape: MaterialShape }) {
	const url = useBlobUrl(shape.props.blobKey)
	const { kind, name, page, pageCount } = shape.props
	return (
		<HTMLContainer className="loci-material" data-kind={kind}>
			<div className="loci-material__caption">
				{name}
				{kind === 'pdf' && pageCount > 1 ? ` · p. ${page} of ${pageCount}` : ''}
			</div>
			{url ? (
				<img src={url} alt={`${name} page ${page}`} draggable={false} className="loci-material__img" />
			) : (
				<div className="loci-material__missing">Loading…</div>
			)}
		</HTMLContainer>
	)
}

/** A page of a pdf or an uploaded image: the student's source material. */
export class MaterialShapeUtil extends ShapeUtil<MaterialShape> {
	static override type = MATERIAL
	static override props: RecordProps<MaterialShape> = {
		w: T.number,
		h: T.number,
		blobKey: T.string,
		kind: T.literalEnum('pdf', 'image'),
		name: T.string,
		page: T.number,
		pageCount: T.number,
		pixelW: T.number,
		pixelH: T.number,
		textItems: T.arrayOf(T.object({ t: T.string, b: T.arrayOf(T.number) })) as never,
	}

	getDefaultProps(): MaterialShape['props'] {
		return { w: 600, h: 800, blobKey: '', kind: 'image', name: '', page: 1, pageCount: 1, pixelW: 0, pixelH: 0, textItems: [] }
	}

	override isAspectRatioLocked() {
		return true
	}

	override canReceiveNewChildrenOfType(_shape: MaterialShape, type: TLShape['type']) {
		return type === HIGHLIGHT
	}

	getGeometry(shape: MaterialShape) {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	override onResize(shape: MaterialShape, info: TLResizeInfo<MaterialShape>) {
		return resizeBox(shape, info)
	}

	component(shape: MaterialShape) {
		return <MaterialView shape={shape} />
	}

	getIndicatorPath(shape: MaterialShape) {
		const path = new Path2D()
		path.rect(0, 0, shape.props.w, shape.props.h)
		return path
	}

	override getText(shape: MaterialShape) {
		return shape.props.textItems.map((t) => t.t).join(' ')
	}

	override async toSvg(shape: MaterialShape) {
		const blob = await getBlob(shape.props.blobKey)
		if (!blob) return <rect width={shape.props.w} height={shape.props.h} fill="#fff" stroke="#ddd" />
		const href = await blobToDataUrl(blob)
		return <image href={href} width={shape.props.w} height={shape.props.h} preserveAspectRatio="none" />
	}
}
