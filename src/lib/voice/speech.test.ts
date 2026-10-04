import { afterEach, describe, expect, it, vi } from 'vitest'
import { startListening } from './speech'

class Recognizer {
	static current: Recognizer
	lang = ''
	interimResults = false
	continuous = false
	onresult: ((event: any) => void) | null = null
	onerror: ((event: any) => void) | null = null
	onend: (() => void) | null = null
	constructor() { Recognizer.current = this }
	start() {}
	stop() { this.onend?.() }
	abort() {}
}

const result = (text: string, isFinal = false) => Object.assign([{ transcript: text }], { isFinal })

afterEach(() => vi.unstubAllGlobals())

describe('live speech transcripts', () => {
	it('keeps word boundaries across final and interim segments without duplicate finals', async () => {
		vi.stubGlobal('window', { SpeechRecognition: Recognizer })
		vi.stubGlobal('navigator', { language: 'en-CA' })
		const update = vi.fn()
		const stop = startListening(update, vi.fn())
		const rec = Recognizer.current
		rec.onresult?.({ resultIndex: 0, results: [result('What is a gradient', true), result('and how')] })
		expect(update).toHaveBeenLastCalledWith('What is a gradient and how')
		rec.onresult?.({ resultIndex: 1, results: [result('What is a gradient', true), result('and how does it relate', true)] })
		expect(await stop()).toBe('What is a gradient and how does it relate')
	})
	it('uses the revised interim transcript and filters misrecognized languages', async () => {
		vi.stubGlobal('window', { SpeechRecognition: Recognizer })
		vi.stubGlobal('navigator', { language: 'en-US' })
		const update = vi.fn()
		const stop = startListening(update, vi.fn())
		const rec = Recognizer.current
		rec.onresult?.({ resultIndex: 0, results: [result('What is a radiant')] })
		rec.onresult?.({ resultIndex: 0, results: [result('What is a gradient')] })
		expect(update).toHaveBeenLastCalledWith('What is a gradient')
		rec.onresult?.({ resultIndex: 0, results: [result('东台市。')] })
		expect(update).toHaveBeenLastCalledWith('')
		expect(await stop()).toBe('')
	})
})
