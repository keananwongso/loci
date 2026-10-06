'use client'
/**
 * Browser side of the demo pack: fetch it, put its materials on the board, find what a step points
 * at, and load recorded takes. Everything is static files under public/demo/.
 */
import type { Editor } from '@/lib/whiteboard'
import { ingestFiles, type IngestProgress } from '@/lib/canvas/ingest'
import { MATERIAL, type MaterialShape } from '@/lib/canvas/shape-types'
import { findTextBox } from '@/lib/documents/text'
import { registerStaticVoice } from '@/lib/voice/player'
import { DEMO_DIR, DemoPackSchema, TakeSchema, type DemoPack, type DemoStep, type Take } from './pack'

let packPromise: Promise<DemoPack | null> | null = null

/** The pack, or null if there is none or it doesn't parse (logged). Fetched once per page load. */
export function loadPack(): Promise<DemoPack | null> {
	packPromise ??= fetch(`${DEMO_DIR}/pack.json`, { cache: 'no-cache' })
		.then((r) => (r.ok ? r.json() : null))
		.then((json) => {
			if (!json) return null
			const parsed = DemoPackSchema.safeParse(json)
			if (!parsed.success) console.warn('[loci] public/demo/pack.json is invalid:', parsed.error.issues.slice(0, 3))
			return parsed.success ? parsed.data : null
		})
		.catch(() => null)
	return packPromise
}

/** Forget the cached pack (the admin view changed it). */
export function reloadPack() {
	packPromise = null
	voicePromise = null
}

let voicePromise: Promise<void> | null = null

/** Pre-rendered voice for the pack's lines and takes, so they play without calling Fish. */
export function loadPackVoice(): Promise<void> {
	voicePromise ??= fetch(`${DEMO_DIR}/voice.json`, { cache: 'no-cache' })
		.then((r) => (r.ok ? r.json() : {}))
		.then((map: Record<string, string>) =>
			registerStaticVoice(Object.fromEntries(Object.entries(map).map(([text, file]) => [text, `${DEMO_DIR}/${file}`])))
		)
		.catch(() => {})
	return voicePromise
}

export async function loadTake(path: string): Promise<Take | null> {
	try {
		const res = await fetch(`${DEMO_DIR}/${path}`, { cache: 'no-cache' })
		if (!res.ok) return null
		const parsed = TakeSchema.safeParse(await res.json())
		if (!parsed.success) console.warn(`[loci] ${path} is not a valid take`)
		return parsed.success ? (parsed.data as Take) : null
	} catch {
		return null
	}
}

/** Put the pack's materials on an empty board, in order, each with its role. */
export async function placePack(editor: Editor, pack: DemoPack, progress?: IngestProgress) {
	for (const m of pack.materials) {
		const res = await fetch(`${DEMO_DIR}/${m.file}`)
		if (!res.ok) {
			console.warn(`[loci] demo material ${m.file} is missing`)
			continue
		}
		const blob = await res.blob()
		await ingestFiles(editor, [new File([blob], m.file, { type: blob.type })], progress, { role: m.role, select: false })
	}
	// Frame the first page, where the first step points.
	const first = packMaterials(editor, pack)[0]
	if (first) {
		const b = editor.getShapePageBounds(first)!
		editor.zoomToBounds({ x: b.x - 40, y: b.y - 110, w: b.w * 2.1, h: Math.min(b.h, b.w * 1.1) + 150 }, { inset: 40 })
	}
}

/** The pack's pages on the board. */
export function packMaterials(editor: Editor, pack: DemoPack): MaterialShape[] {
	const files = new Set(pack.materials.map((m) => m.file))
	return editor.getCurrentPageShapes().filter((s): s is MaterialShape => s.type === MATERIAL && files.has((s as MaterialShape).props.name))
}

/** Whether the board holds the pack's material and nothing the visitor brought. */
export function boardHasPack(editor: Editor, pack: DemoPack) {
	return packMaterials(editor, pack).length > 0
}

/** Where on the board a step's `point` phrase is, in page coordinates, and the page it is on. */
export function pointArea(editor: Editor, step: DemoStep): { page: MaterialShape; area: { x: number; y: number; w: number; h: number } } | null {
	if (!step.point) return null
	const { file, page: n, text } = step.point
	const page = editor
		.getCurrentPageShapes()
		.find((s): s is MaterialShape => s.type === MATERIAL && (s as MaterialShape).props.name === file && (s as MaterialShape).props.page === n)
	if (!page) return null
	const box = findTextBox(page.props.textItems, text)
	if (!box) return null
	const b = editor.getShapePageBounds(page)!
	const pad = 6
	return { page, area: { x: b.x + box.x * b.w - pad, y: b.y + box.y * b.h - pad, w: box.w * b.w + pad * 2, h: box.h * b.h + pad * 2 } }
}
