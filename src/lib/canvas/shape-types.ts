/**
 * Loci's custom tldraw shape types. Registered with tldraw through module augmentation,
 * so `editor.createShape({ type: 'loci-equation', ... })` is fully typed.
 */
import type { TLShape } from 'tldraw'
import type { GraphItem, HighlightColor } from '@/lib/actions/schema'
import type { TextItem } from '@/lib/tutor/types'

export const MATERIAL = 'loci-material'
export const EQUATION = 'loci-equation'
export const GRAPH = 'loci-graph'
export const HIGHLIGHT = 'loci-highlight'
export const REGION = 'loci-region'

declare module 'tldraw' {
	export interface TLGlobalShapePropsMap {
		/** A pdf page or uploaded image. The pixels live in IndexedDB under `blobKey`. */
		[MATERIAL]: {
			w: number
			h: number
			blobKey: string
			kind: 'pdf' | 'image'
			name: string
			page: number
			pageCount: number
			pixelW: number
			pixelH: number
			textItems: TextItem[]
		}
		/** A KaTeX equation; `baseW`/`baseH` are its natural size, `w`/`h` its current size. */
		[EQUATION]: { w: number; h: number; baseW: number; baseH: number; latex: string; color: string; size: 's' | 'm' | 'l' }
		/** A coordinate plane whose contents are stored in math coordinates. */
		[GRAPH]: {
			w: number
			h: number
			xMin: number
			xMax: number
			yMin: number
			yMax: number
			grid: boolean
			xLabel: string
			yLabel: string
			title: string
			items: GraphItem[]
		}
		[HIGHLIGHT]: { w: number; h: number; style: 'marker' | 'box' | 'circle' | 'underline'; color: HighlightColor }
		/** A box the student drags around part of the board to ask about it. */
		[REGION]: { w: number; h: number }
	}
}

export type MaterialShape = TLShape<typeof MATERIAL>
export type EquationShape = TLShape<typeof EQUATION>
export type GraphShape = TLShape<typeof GRAPH>
export type HighlightShape = TLShape<typeof HIGHLIGHT>
export type RegionShape = TLShape<typeof REGION>

/** Shape meta Loci writes on everything the tutor creates. */
export type LociMeta = {
	author?: 'assistant'
	turn?: number
}
