import { describe, expect, it } from 'vitest'
import { spokenScriptWords } from './read-along'

const script = 'What’s a gradient, and how does it relate to partial derivatives?'

describe('spoken script progress', () => {
	it('fills only the words heard so far, ignoring punctuation and casing', () => {
		expect([...spokenScriptWords(script, "WHAT'S a gradient")]).toEqual([0, 1, 2])
		expect([...spokenScriptWords(script, 'what is a gradient and how does it relate to partial derivatives')]).toEqual(Array.from({ length: 11 }, (_, i) => i))
	})
	it('accepts fillers without marking skipped words as spoken', () => {
		expect([...spokenScriptWords(script, 'um what is a gradient how')]).toEqual([0, 1, 2, 4])
		expect([...spokenScriptWords(script, 'derivatives')]).toEqual([10])
	})
	it('handles repeated words in order and revised interim results', () => {
		expect([...spokenScriptWords('to be or not to be', 'to be')]).toEqual([0, 1])
		expect([...spokenScriptWords(script, 'what is a radiant')]).toEqual([0, 1])
		expect([...spokenScriptWords(script, 'what is a gradient')]).toEqual([0, 1, 2])
		expect([...spokenScriptWords(script, '')]).toEqual([])
	})
})
