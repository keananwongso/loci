import { createStore, get, set } from 'idb-keyval'
import type { TLCamera, TLRecord, TLStoreSnapshot } from 'tldraw'
import { lineClip, type WritingLine } from '@/lib/canvas/writing-layout'

export interface LessonCue { text: string; start: number; end: number; audioKey?: string; voiced?: boolean }
export interface LessonFrame { t: number; put: TLRecord[]; remove: TLRecord['id'][]; camera: TLCamera }
export interface LessonWriting { shapeId: string; start: number; end: number; lines: WritingLine[] }
export interface LessonRecording {
	version: 1
	baseline: TLStoreSnapshot
	camera: TLCamera
	frames: LessonFrame[]
	cues: LessonCue[]
	writing?: LessonWriting[]
	duration: number
}

/** The same measured line reveal as the live pen, now driven by the seekable playhead. */
export function writingClip(writing: LessonWriting, time: number): string | null {
	if (time >= writing.end) return null
	const progress = Math.max(0, Math.min(1, (time - writing.start) / Math.max(1, writing.end - writing.start)))
	if (writing.lines.length < 2) return `inset(0 ${(1 - progress) * 100}% 0 0)`
	const width = writing.lines.reduce((sum, line) => sum + line.w, 0)
	let distance = progress * width
	for (const line of writing.lines) {
		if (distance <= line.w) return lineClip(line, Math.max(0, Math.min(1, distance / Math.max(.0001, line.w))))
		distance -= line.w
	}
	return null
}
const store = typeof indexedDB !== 'undefined' ? createStore('loci-lessons', 'recordings') : undefined
export async function saveLesson(id: string, lesson: LessonRecording) { await set(id, lesson, store) }
export async function loadLesson(id: string): Promise<LessonRecording | undefined> { return get(id, store) }

/** Rebuild from the baseline on every seek; updates, deletions and backward jumps stay exact. */
export function lessonAt(lesson: LessonRecording, time: number) {
	const records = { ...lesson.baseline.store }
	let camera = lesson.camera
	for (const frame of lesson.frames) {
		if (frame.t > time) break
		for (const id of frame.remove) delete records[id]
		for (const record of frame.put) records[record.id] = record
		camera = frame.camera
	}
	return { snapshot: { schema: lesson.baseline.schema, store: records }, camera }
}
