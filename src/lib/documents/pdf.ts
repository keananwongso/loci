'use client'
/**
 * Pdf ingestion with pdf.js, entirely in the browser: each page is rasterised to an image
 * and its text is extracted with positions normalised to the page (0..1), which is what
 * lets the tutor highlight exact symbols later.
 */
import type { TextItem } from '@/lib/tutor/types'

export interface RenderedPage {
	page: number
	pageCount: number
	blob: Blob
	pixelW: number
	pixelH: number
	/** Aspect of the page in points, for display sizing. */
	aspect: number
	textItems: TextItem[]
}

const TARGET_WIDTH = 1700
export const MAX_PAGES = 40

async function loadPdfJs() {
	// The legacy build ships polyfills for very new JS features that current browsers lack.
	const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
	if (!pdfjs.GlobalWorkerOptions.workerSrc) {
		pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString()
	}
	return pdfjs
}

function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.9): Promise<Blob> {
	return new Promise((resolve, reject) =>
		canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode page image'))), type, quality)
	)
}

const r4 = (n: number) => Math.round(n * 10000) / 10000

/** Render pages of a pdf. Calls `onPage` as each page finishes so the board can fill in progressively. */
export async function renderPdf(data: ArrayBuffer, onPage: (page: RenderedPage) => Promise<void> | void) {
	const pdfjs = await loadPdfJs()
	const task = pdfjs.getDocument({ data: new Uint8Array(data) })
	const doc = await task.promise
	const pageCount = Math.min(doc.numPages, MAX_PAGES)
	try {
		for (let n = 1; n <= pageCount; n++) {
			const page = await doc.getPage(n)
			const base = page.getViewport({ scale: 1 })
			const viewport = page.getViewport({ scale: TARGET_WIDTH / base.width })
			const canvas = document.createElement('canvas')
			canvas.width = Math.ceil(viewport.width)
			canvas.height = Math.ceil(viewport.height)
			const ctx = canvas.getContext('2d')!
			ctx.fillStyle = '#ffffff'
			ctx.fillRect(0, 0, canvas.width, canvas.height)
			await page.render({ canvas, canvasContext: ctx, viewport }).promise

			const content = await page.getTextContent()
			const textItems: TextItem[] = []
			for (const item of content.items) {
				if (!('str' in item) || !item.str.trim()) continue
				// Same transform pdf.js's own text layer uses: glyph space -> viewport pixels.
				const tx = pdfjs.Util.transform(viewport.transform, item.transform)
				const fontHeight = Math.hypot(tx[2], tx[3])
				const left = tx[4]
				const top = tx[5] - fontHeight
				const width = item.width * viewport.scale
				textItems.push({
					t: item.str,
					b: [r4(left / viewport.width), r4(top / viewport.height), r4(width / viewport.width), r4((fontHeight * 1.15) / viewport.height)],
				})
			}

			await onPage({
				page: n,
				pageCount,
				blob: await canvasToBlob(canvas),
				pixelW: canvas.width,
				pixelH: canvas.height,
				aspect: base.height / base.width,
				textItems,
			})
			page.cleanup()
		}
	} finally {
		await task.destroy()
	}
	return { pageCount, truncated: doc.numPages > MAX_PAGES }
}
