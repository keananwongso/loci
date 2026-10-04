import { describe, expect, it } from 'vitest'
import { gridStep } from './serialize'

describe('coordinate grid', () => {
	it('keeps roughly ten lines across a full page or a close-up', () => {
		expect(gridStep(1)).toBe(0.1)
		expect(gridStep(0.4)).toBe(0.05)
		expect(gridStep(0.15)).toBe(0.02)
		expect(gridStep(0.03)).toBe(0.01)
	})
})
