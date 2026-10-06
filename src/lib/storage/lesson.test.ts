import { describe, expect, it, vi } from 'vitest'
import type { Editor, TLRecord, TLStoreSnapshot, TLCamera } from 'tldraw'
import { createLessonPlayback, lessonAt, writingClip, type LessonRecording } from './lesson'

const record = (id: string, value: string) => ({ id, typeName: 'shape', props: { value } }) as unknown as TLRecord
describe('seeking a saved canvas explanation', () => {
	it('applies forward changes once, interpolates camera samples, and rebuilds only on seeks', () => {
		const original = record('shape:notes', 'notes')
		const equation = record('shape:eq', 'x = 1')
		const corrected = record('shape:eq', 'x = 2')
		const camera = { id: 'camera:page:page', typeName: 'camera', x: 0, y: 0, z: 1 } as TLCamera
		const lesson: LessonRecording = { version: 1, baseline: { schema: {}, store: { [original.id]: original } } as TLStoreSnapshot, camera, cues: [], duration: 1000, frames: [
			{ t: 100, put: [equation], remove: [], camera: { ...camera, x: 100, z: 2 } },
			{ t: 200, put: [corrected], remove: [], camera: { ...camera, x: 200, z: 3 } },
			{ t: 300, put: [], remove: [equation.id], camera: { ...camera, x: 200, z: 3 } },
		] }
		let records: Record<string, TLRecord> = {}
		const loadSnapshot = vi.fn((snapshot: TLStoreSnapshot) => { records = { ...snapshot.store } })
		const put = vi.fn((items: TLRecord[]) => { for (const r of items) records[r.id] = r })
		const remove = vi.fn((ids: string[]) => { for (const id of ids) delete records[id] })
		const setCamera = vi.fn()
		const editor = { loadSnapshot, setCamera, updateInstanceState: vi.fn(), store: { mergeRemoteChanges: (fn: () => void) => fn(), put, remove } } as unknown as Editor
		const play = createLessonPlayback(editor, lesson)
		play(0)
		play(50)
		expect(setCamera).toHaveBeenLastCalledWith({ x: 50, y: 0, z: 1.5 }, { immediate: true })
		play(150)
		expect(records).toEqual(lessonAt(lesson, 150).snapshot.store)
		play(175)
		expect(put).toHaveBeenCalledTimes(1)
		play(250)
		expect(records).toEqual(lessonAt(lesson, 250).snapshot.store)
		play(350)
		expect(records).toEqual(lessonAt(lesson, 350).snapshot.store)
		expect(loadSnapshot).toHaveBeenCalledTimes(1)
		play(150, true)
		expect(records).toEqual(lessonAt(lesson, 150).snapshot.store)
		play(250)
		expect(records).toEqual(lessonAt(lesson, 250).snapshot.store)
		play(0)
		expect(records).toEqual(lesson.baseline.store)
		expect(loadSnapshot).toHaveBeenCalledTimes(3)
		const still = createLessonPlayback(editor, { ...lesson, frames: [{ t: 1000, put: [], remove: [], camera: { ...camera, x: 100 } }] })
		still(0)
		still(800)
		expect(setCamera).toHaveBeenLastCalledWith({ x: 0, y: 0, z: 1 }, { immediate: true })
		still(950)
		expect(setCamera).toHaveBeenLastCalledWith({ x: 50, y: 0, z: 1 }, { immediate: true })
	})
	it('reveals handwriting at the seek position and preserves completed lines', () => {
		const writing = { shapeId: 'shape:notes', start: 1000, end: 3000, lines: [{ x: 0, y: 0, w: .8, h: .4 }, { x: 0, y: .5, w: .4, h: .4 }] }
		expect(writingClip(writing, 500)).toContain('0% 0%')
		expect(writingClip(writing, 2500)).toContain('102% 50%')
		expect(writingClip(writing, 2500)).toContain('10.')
		expect(writingClip(writing, 3000)).toBeNull()
		expect(writingClip({ ...writing, lines: [] }, 2000)).toBe('inset(0 50% 0 0)')
	})
	it('reverses updates and deletions on backward seeks without touching the stored lesson', () => {
		const original = record('shape:notes', 'original notes')
		const equation = record('shape:eq', 'x = 1')
		const corrected = record('shape:eq', 'x = 2')
		const camera = { id: 'camera:page:page', typeName: 'camera', x: 0, y: 0, z: 1 } as TLCamera
		const lesson: LessonRecording = { version: 1, baseline: { schema: {}, store: { [original.id]: original } } as TLStoreSnapshot, camera, cues: [], duration: 5000, frames: [
			{ t: 1000, put: [equation], remove: [], camera },
			{ t: 2000, put: [corrected], remove: [], camera: { ...camera, x: 120 } },
			{ t: 3000, put: [], remove: [equation.id], camera },
		] }
		expect(lessonAt(lesson, 2500).snapshot.store[equation.id]).toEqual(corrected)
		expect(lessonAt(lesson, 3500).snapshot.store[equation.id]).toBeUndefined()
		expect(lessonAt(lesson, 1500).snapshot.store[equation.id]).toEqual(equation)
		expect(lessonAt(lesson, 0).snapshot.store).toEqual(lesson.baseline.store)
		expect(lessonAt(lesson, 2500).camera.x).toBe(120)
		expect(lessonAt(lesson, 1500).camera.x).toBe(0)
		expect(lesson.baseline.store).toEqual({ [original.id]: original })
	})
})
