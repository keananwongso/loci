import { describe, expect, it } from 'vitest'
import { latexToSpoken, spokenFraction, toSpoken } from './spoken'

describe('toSpoken', () => {
	it('turns dashes into pauses and keeps number ranges', () => {
		expect(toSpoken('Sure — the example is three moves, one per line.')).toBe('Sure, the example is three moves, one per line.')
		expect(toSpoken('Length exactly 1 — that is the rule.')).toBe('Length exactly 1, that is the rule.')
		expect(toSpoken('pages 2–4')).toBe('pages 2 to 4')
		expect(toSpoken('first; then')).toBe('first, then')
	})

	it('drops markdown', () => {
		expect(toSpoken('just **three moves**, in *order*')).toBe('just three moves, in order')
	})

	it('reads stray LaTeX aloud', () => {
		expect(toSpoken('so $u = \\langle \\frac{3}{5}, \\frac{4}{5} \\rangle$.')).toBe('so u equals three fifths, four fifths.')
		expect(toSpoken('$|v| = \\sqrt{9 + 16} = 5$')).toBe('the length of v equals the square root of 9 plus 16 equals 5')
		expect(toSpoken('$D_u f = \\nabla f \\cdot u$')).toBe('D sub u f equals the gradient of f dot u')
	})
})

describe('spoken math', () => {
	it('names small fractions', () => {
		expect(spokenFraction('1', '2')).toBe('one half')
		expect(spokenFraction('3', '5')).toBe('three fifths')
		expect(spokenFraction('61', '5')).toBe('61 over 5')
	})
	it('reads squares and colours', () => {
		expect(latexToSpoken('{\\color{#2457e6}{x}}^2')).toBe('x squared')
	})
})
