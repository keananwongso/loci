'use client'
import { speechClock } from '@/lib/voice/transport'
import type { Editor } from '@/lib/whiteboard'
import type { LessonCue, LessonRecording } from '@/lib/storage/lesson'
import { putBlob } from '@/lib/storage/blobs'
import { observeWriting } from '@/lib/canvas/hand'

/** Record the actual document changes, not a second run of model actions with new placement. */
export function recordLesson(editor: Editor, turnId: string) {
	const baseline = editor.store.getStoreSnapshot('document')
	const started = speechClock()
	const recording: LessonRecording = { version: 2, pageId: editor.pageId, baseline, camera: editor.getCamera(), frames: [], cues: [], duration: 0 }
	let previous = baseline.store
	let lastCamera = recording.camera
	const now = () => speechClock() - started
	const stopWriting = observeWriting(({ shapeId, duration, lines }) => {
		const start = now()
		;(recording.writing ??= []).push({ shapeId, start, end: start + duration, lines })
	})
	const capture = () => {
		const current = editor.store.getStoreSnapshot('document').store
		const camera = editor.getCamera()
		const put = Object.values(current).filter((r) => previous[r.id] !== r)
		const remove = Object.keys(previous).filter((id) => !current[id as keyof typeof current]) as typeof recording.frames[number]['remove']
		if (put.length || remove.length || camera.x !== lastCamera.x || camera.y !== lastCamera.y || camera.z !== lastCamera.z) {
			recording.frames.push({ t: now(), put, remove, camera })
			previous = current
			lastCamera = camera
		}
	}
	const interval = setInterval(capture, 100)
	const writes: Promise<void>[] = []
	return {
		cue(text: string, voiced = false) {
			const cue: LessonCue = { text, voiced, start: now(), end: now() + 300 + text.split(/\s+/).length * 400 }
			recording.cues.push(cue)
			return cue
		},
		endCue(cue: LessonCue) { cue.end = now() },
		audio(cue: LessonCue, blob: Promise<Blob | null>) {
			const key = `lesson-${turnId}-${recording.cues.indexOf(cue)}`
			writes.push(blob.then(async (b) => { if (b) { await putBlob(key, b); cue.audioKey = key } }).catch(() => {}))
		},
		async finish() {
			clearInterval(interval)
			stopWriting()
			capture()
			const ended = now()
			for (let i = 0; i < recording.cues.length; i++) {
				const cue = recording.cues[i]
				if (!cue.voiced) cue.end = recording.cues[i + 1]?.start ?? ended
			}
			recording.duration = Math.max(ended, ...recording.cues.map((c) => c.end))
			await Promise.all(writes)
			// Replays start at the explanation, skipping the wait for the model.
			const first = Math.min(recording.cues[0]?.start ?? Infinity, recording.frames[0]?.t ?? Infinity)
			if (Number.isFinite(first)) {
				recording.frames = recording.frames.map((f) => ({ ...f, t: f.t - first }))
				recording.cues = recording.cues.map((c) => ({ ...c, start: c.start - first, end: c.end - first }))
				recording.writing = recording.writing?.map((w) => ({ ...w, start: w.start - first, end: w.end - first }))
				recording.duration -= first
			}
			return recording
		},
	}
}
