import { describe, expect, it } from 'vitest'
import { cleanVoiceTranscript } from './transcript'

describe('English voice transcripts', () => {
	it('keeps English, names, and mathematical symbols', () => {
		expect(cleanVoiceTranscript('  What does ∇f mean at (1, 2)? ')).toBe('What does ∇f mean at (1, 2)?')
		expect(cleanVoiceTranscript('Explain René’s equation.')).toBe('Explain René’s equation.')
	})
	it('rejects CJK misrecognitions without turning them into partial questions', () => {
		expect(cleanVoiceTranscript('东台市。')).toBe('')
		expect(cleanVoiceTranscript('What is 梯度?')).toBe('')
		expect(cleanVoiceTranscript('勾配とは')).toBe('')
		expect(cleanVoiceTranscript('기울기')).toBe('')
	})
})
