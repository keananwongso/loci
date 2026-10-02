import { describe, expect, it } from 'vitest'
import { mathCaption } from './player'

describe('mathCaption', () => {
	it('turns common LaTeX into readable caption text', () => {
		expect(mathCaption('D_u f = \\nabla f \\cdot u')).toBe('Dᵤ f = ∇ f · u')
		expect(mathCaption('x^2 + y_{0}')).toBe('x² + y₀')
	})
})
