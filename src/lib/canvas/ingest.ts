'use client'
/**
 * Puts uploaded pdfs and images on the board as material shapes. Files are processed in the
 * browser and stored in IndexedDB; nothing is uploaded.
 */
import { createShapeId, type Editor, type TLShapeId } from 'tldraw'
import { renderPdf } from '@/lib/documents/pdf'
import { putBlob, randomKey } from '@/lib/storage/blobs'
import { MATERIAL, type MaterialShape } from './shape-types'
import { union, type Rect } from './placement'
import { guessRole, type MaterialMeta, type MaterialRole } from '@/lib/documents/roles'

export const PAGE_WIDTH = 680
const PAGE_GAP = 56
const MAX_IMAGE_PX = 3000

export const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']

function slug(name: string) {
	const base = name
		.replace(/\.[a-z0-9]+$/i, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 24)
	return base || 'material'
}

function uniqueId(editor: Editor, base: string): TLShapeId {
	let id = createShapeId(base)
	let n = 2
	while (editor.getShape(id)) id = createShapeId(`${base}-${n++}`)
	return id
}

/** Where new material goes: to the right of everything already on the board. */
function nextColumnOrigin(editor: Editor): { x: number; y: number } {
	const bounds = editor
		.getCurrentPageShapes()
		.map((s) => editor.getShapePageBounds(s))
		.filter((b): b is NonNullable<typeof b> => Boolean(b))
	if (!bounds.length) return { x: 0, y: 0 }
	const all = union(bounds.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })))
	return { x: all.x + all.w + 200, y: all.y }
}

/**
 * Frame new material on the left of the view, leaving room on the right for the tutor and room
 * above for the page's caption (its name and role), which would otherwise sit under the top bar.
 */
function frame(editor: Editor, rect: Rect) {
	const target = { x: rect.x - 40, y: rect.y - 110, w: rect.w * 2.1, h: Math.min(rect.h, rect.w * 1.1) + 150 }
	editor.zoomToBounds(target, { animation: { duration: 450 }, inset: 40 })
}

export interface IngestProgress {
	(message: string | null): void
}

export interface IngestOptions {
	/** The role to give the material instead of guessing it from the file name. */
	role?: MaterialRole
	/** Select the first new page when done (default true). */
	select?: boolean
}

export async function ingestFiles(editor: Editor, files: File[], progress?: IngestProgress, opts: IngestOptions = {}) {
	const created: TLShapeId[] = []
	for (const file of files) {
		const role = opts.role ?? guessRole(file.name)
		try {
			if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
				created.push(...(await ingestPdf(editor, file, role, progress)))
			} else if (file.type.startsWith('image/')) {
				created.push(await ingestImage(editor, file, role))
			} else {
				progress?.(`Unsupported file: ${file.name}. Use a pdf, png or jpg.`)
				await new Promise((r) => setTimeout(r, 2500))
			}
		} catch (err) {
			console.error('[loci] could not import', file.name, err)
			progress?.(`Could not open ${file.name}.`)
			await new Promise((r) => setTimeout(r, 2500))
		}
	}
	progress?.(null)
	if (created.length && opts.select !== false) editor.select(created[0])
	return created
}

async function ingestPdf(editor: Editor, file: File, role: MaterialRole, progress?: IngestProgress) {
	const origin = nextColumnOrigin(editor)
	const base = slug(file.name)
	const meta: MaterialMeta = { role, doc: randomKey('doc') }
	const ids: TLShapeId[] = []
	let y = origin.y
	progress?.(`Opening ${file.name}…`)
	const { truncated } = await renderPdf(await file.arrayBuffer(), async (p) => {
		progress?.(`Rendering ${file.name}: page ${p.page} of ${p.pageCount}`)
		const blobKey = randomKey('page')
		await putBlob(blobKey, p.blob)
		const id = uniqueId(editor, `${base}-p${p.page}`)
		const h = Math.round(PAGE_WIDTH * p.aspect)
		editor.createShape<MaterialShape>({
			id,
			type: MATERIAL,
			x: origin.x,
			y,
			meta: { ...meta },
			props: {
				w: PAGE_WIDTH,
				h,
				blobKey,
				kind: 'pdf',
				name: file.name,
				page: p.page,
				pageCount: p.pageCount,
				pixelW: p.pixelW,
				pixelH: p.pixelH,
				textItems: p.textItems,
			},
		})
		if (p.page === 1) frame(editor, { x: origin.x, y, w: PAGE_WIDTH, h })
		ids.push(id)
		y += h + PAGE_GAP
	})
	if (truncated) {
		progress?.('Only the first 40 pages were imported.')
		await new Promise((r) => setTimeout(r, 2500))
	}
	return ids
}

async function ingestImage(editor: Editor, file: File, role: MaterialRole) {
	const bitmap = await createImageBitmap(file)
	let blob: Blob = file
	let pixelW = bitmap.width
	let pixelH = bitmap.height
	const scale = Math.min(1, MAX_IMAGE_PX / Math.max(pixelW, pixelH))
	if (scale < 1 || !/image\/(png|jpeg)/.test(file.type)) {
		const canvas = document.createElement('canvas')
		canvas.width = Math.round(pixelW * scale)
		canvas.height = Math.round(pixelH * scale)
		canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
		blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/png'))
		pixelW = canvas.width
		pixelH = canvas.height
	}
	bitmap.close()

	const blobKey = randomKey('img')
	await putBlob(blobKey, blob)
	const origin = nextColumnOrigin(editor)
	const w = Math.min(PAGE_WIDTH, Math.max(320, pixelW / 1.5))
	const h = Math.round((w * pixelH) / pixelW)
	const id = uniqueId(editor, slug(file.name))
	editor.createShape<MaterialShape>({
		id,
		type: MATERIAL,
		x: origin.x,
		y: origin.y,
		meta: { role, doc: blobKey },
		props: { w, h, blobKey, kind: 'image', name: file.name || 'pasted image', page: 1, pageCount: 1, pixelW, pixelH, textItems: [] },
	})
	frame(editor, { x: origin.x, y: origin.y, w, h })
	return id
}

/** Set the role of a material and every other page of the same file. Undoable. */
export function setMaterialRole(editor: Editor, shape: MaterialShape, role: MaterialRole) {
	const doc = (shape.meta as MaterialMeta).doc
	const pages = editor
		.getCurrentPageShapes()
		.filter((s): s is MaterialShape => s.type === MATERIAL)
		.filter((s) =>
			doc ? (s.meta as MaterialMeta).doc === doc : s.props.name === shape.props.name && s.props.pageCount === shape.props.pageCount
		)
	editor.markHistoryStoppingPoint('material-role')
	editor.updateShapes(pages.map((s) => ({ id: s.id, type: MATERIAL, meta: { ...s.meta, role } })))
}
