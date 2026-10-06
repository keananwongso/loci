import { describe, expect, it } from 'vitest'
import type { TLRecord, TLStoreSnapshot, TLCamera } from 'tldraw'
import { lessonAt, writingClip, type LessonRecording } from './lesson'

const record = (id: string, value: string) => ({ id, typeName: 'shape', props: { value } }) as unknown as TLRecord
describe('seeking a saved canvas explanation', () => {
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
