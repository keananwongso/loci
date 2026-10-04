import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('./level', () => ({ openMic: vi.fn(async () => ({})), releaseMic: vi.fn() }))
vi.mock('./player', () => ({ hasFish: () => true, checkSpeechProvider: async () => 'fish' }))
import { startRecording } from './recorder'

class Recorder {
	static current: Recorder
	static isTypeSupported() { return true }
	state = 'recording'
	mimeType = 'audio/webm'
	ondataavailable?: (event: { data: Blob }) => void
	onstop?: () => void
	constructor() { Recorder.current = this }
	start() {}
	stop() { this.state = 'inactive'; this.onstop?.() }
	emit(size = 4000) { this.ondataavailable?.({ data: new Blob([new Uint8Array(size)]) }) }
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
	vi.stubGlobal('MediaRecorder', Recorder)
	vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('transcript previews during recording', () => {
	it('sends cumulative audio while held, caps previews at two, and preserves the full final recording', async () => {
		const sizes: number[] = []
		vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
			sizes.push(init.body.size)
			return Response.json({ text: `preview ${sizes.length}` })
		}))
		const update = vi.fn()
		const recording = startRecording(update)
		await Promise.resolve()
		await vi.advanceTimersByTimeAsync(1600)
		Recorder.current.emit()
		await vi.advanceTimersByTimeAsync(0)
		expect(update).toHaveBeenLastCalledWith('preview 1')
		await vi.advanceTimersByTimeAsync(1600)
		Recorder.current.emit()
		await vi.advanceTimersByTimeAsync(0)
		expect(sizes).toEqual([4000, 8000])
		await vi.advanceTimersByTimeAsync(1600)
		Recorder.current.emit()
		await vi.advanceTimersByTimeAsync(0)
		expect(sizes).toHaveLength(2)
		expect((await recording.stop())?.size).toBe(12000)
	})
	it('does not spend preview requests when browser recognition already supplies live words', async () => {
		const fetch = vi.fn()
		vi.stubGlobal('fetch', fetch)
		const recording = startRecording(vi.fn(), () => true)
		await Promise.resolve()
		await vi.advanceTimersByTimeAsync(2000)
		Recorder.current.emit()
		await vi.advanceTimersByTimeAsync(0)
		expect(fetch).not.toHaveBeenCalled()
		await recording.stop()
	})
	it('ignores previews that arrive after release', async () => {
		let finish!: (response: Response) => void
		vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve })))
		const update = vi.fn()
		const recording = startRecording(update)
		await Promise.resolve()
		await vi.advanceTimersByTimeAsync(1600)
		Recorder.current.emit()
		await vi.advanceTimersByTimeAsync(0)
		await recording.stop()
		finish(Response.json({ text: 'late words' }))
		await vi.advanceTimersByTimeAsync(0)
		expect(update).not.toHaveBeenCalled()
	})
})
