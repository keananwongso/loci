import { describe, expect, it } from 'vitest'
import { guessRole, roleOf } from './roles'

describe('material roles', () => {
	it('guesses from the file name', () => {
		expect(guessRole('MATH200_Syllabus_2026.pdf')).toBe('syllabus')
		expect(guessRole('midterm-2-mark-scheme.pdf')).toBe('mark-scheme')
		expect(guessRole('Midterm 2.pdf')).toBe('questions')
		expect(guessRole('hw3.pdf')).toBe('questions')
		expect(guessRole('directional-derivatives.pdf')).toBe('notes')
		expect(guessRole('IMG_2041.png')).toBe('notes')
	})

	it('reads notes for material saved before roles existed', () => {
		expect(roleOf({})).toBe('notes')
		expect(roleOf({ role: 'nonsense' })).toBe('notes')
		expect(roleOf({ role: 'syllabus' })).toBe('syllabus')
	})
})
