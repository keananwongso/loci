'use client'
/**
 * Text recognition for images (screenshots, photos) with tesseract.js, in the browser. Words come
 * out as text items in the same normalised page coordinates pdf text uses, so the tutor quotes and
 * highlights them the same way. Tesseract's worker, core and English data are served by this app
 * (copied to /ocr by scripts/ocr-assets.mjs) and only loaded once an image is added.
 */
import type { TextItem } from '@/lib/tutor/types'

export interface OcrBox {
	x0: number
	y0: number
	x1: number
	y1: number
}

export interface OcrLine {
	bbox: OcrBox
	words: Array<{ text: string; confidence: number; bbox: OcrBox }>
}

/** Words read with less confidence than this (0..100) are left out. */
export const MIN_CONFIDENCE = 55
/** Small images are scaled up first: tesseract reads text best at 20px or more. */
const MIN_OCR_SIDE = 1600

const r4 = (n: number) => Math.round(n * 10000) / 10000

/**
 * One text item per confident word, normalised to the image. Every word takes its line's top and
 * height, so a line reads as one even row, like pdf text. A word followed by another carries the
 * space after it (and its width), so lines read with their spaces whatever the image's shape.
 */
export function ocrItems(lines: OcrLine[], width: number, height: number, minConfidence = MIN_CONFIDENCE): TextItem[] {
	const items: TextItem[] = []
	for (const line of lines) {
		const y = line.bbox.y0
		const h = line.bbox.y1 - line.bbox.y0
		const kept = line.words.flatMap((word, i) => {
			const t = word.text.trim()
			return t && word.confidence >= minConfidence && word.bbox.x1 > word.bbox.x0 ? [{ t, i, ...word.bbox }] : []
		})
		kept.forEach((word, k) => {
			const next = kept[k + 1]
			let x1 = word.x1
			if (next) x1 = next.i === word.i + 1 && next.x0 > word.x1 ? next.x0 : word.x1 + (word.x1 - word.x0) / word.t.length
			items.push({ t: next ? `${word.t} ` : word.t, b: [r4(word.x0 / width), r4(y / height), r4((x1 - word.x0) / width), r4(h / height)] })
		})
	}
	return items
}

type TesseractWorker = Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>>
let worker: Promise<TesseractWorker> | null = null

function getWorker() {
	worker ??= import('tesseract.js').then(({ createWorker }) => {
		// Absolute urls: the worker runs from a blob url, which can't resolve relative ones.
		const base = `${location.origin}/ocr`
		return createWorker('eng', undefined, { workerPath: `${base}/worker.min.js`, corePath: base, langPath: base })
	})
	worker.catch(() => (worker = null))
	return worker
}

/** Read the words in an image. */
export async function recognizeImage(image: Blob): Promise<TextItem[]> {
	const bitmap = await createImageBitmap(image)
	const scale = Math.min(2, Math.max(1, MIN_OCR_SIDE / Math.max(bitmap.width, bitmap.height)))
	const canvas = document.createElement('canvas')
	canvas.width = Math.round(bitmap.width * scale)
	canvas.height = Math.round(bitmap.height * scale)
	const ctx = canvas.getContext('2d')!
	ctx.fillStyle = '#fff'
	ctx.fillRect(0, 0, canvas.width, canvas.height)
	ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
	bitmap.close()
	const { data } = await (await getWorker()).recognize(canvas, {}, { blocks: true, text: false })
	const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines))
	return ocrItems(lines, canvas.width, canvas.height)
}
