import { describe, expect, it } from 'vitest'
import { DemoStepSchema, pickBranch } from './pack'

const step = DemoStepSchema.parse({
	id: 'check',
	kind: 'answer',
	prompt: 'Say what happens to the slope',
	branches: [
		{ id: 'right', match: ['biggest', 'largest', 'max', 'steepest'] },
		{ id: 'zero', match: ['zero', 'flat'], next: 'retry' },
		{ id: 'other', next: 'retry' },
	],
})

describe('pickBranch', () => {
	it('matches whole words, ignoring case and punctuation', () => {
		expect(pickBranch(step, 'It gets the LARGEST!').id).toBe('right')
		expect(pickBranch(step, 'it would be zero?').id).toBe('zero')
		// "maximum" is not the word "max"
		expect(pickBranch(step, 'the maximum').id).toBe('other')
	})

	it('falls back to the catch-all', () => {
		expect(pickBranch(step, 'no idea').id).toBe('other')
		expect(pickBranch(step, '').id).toBe('other')
	})
})
