import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('./level', () => ({ openMic: vi.fn(async () => ({})), releaseMic: vi.fn() }))
vi.mock('./player', () => ({ hasFish: () => true, checkSpeechProvider: async () => 'fish' }))
import { startRecording, transcribe } from './recorder'
import { saveVoiceKey } from '@/lib/storage/voiceKey'

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
	vi.stubGlobal('window', { dispatchEvent: vi.fn() })
	vi.stubGlobal('CustomEvent', class { constructor(public type: string) {} })
	saveVoiceKey(null)
	vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { saveVoiceKey(null); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

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

it('sends personal Fish transcription headers for both page-only and saved references', async () => {
 const send = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ text: 'test words' }))
 vi.stubGlobal('fetch', send)
 saveVoiceKey({ provider: 'fish', key: 'page-key' })
 expect(await transcribe(new Blob(['audio']))).toBe('test words')
 expect(send.mock.calls[0][1]?.headers).toMatchObject({ 'x-loci-voice-key': 'page-key', 'x-loci-voice-provider': 'fish' })
 saveVoiceKey({ provider: 'fish', key: '', saved: true })
 await transcribe(new Blob(['audio']))
 expect(send.mock.calls[1][1]?.headers).toMatchObject({ 'x-loci-saved-voice': '1' })
 saveVoiceKey({ provider: 'elevenlabs', key: 'eleven-key', voiceId: 'voice' })
 await transcribe(new Blob(['audio']))
 expect(send.mock.calls[2][1]?.headers).toEqual({ 'Content-Type': '' })
})
