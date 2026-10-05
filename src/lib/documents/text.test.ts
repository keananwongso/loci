import { describe, expect, it } from 'vitest'
import { containsText, findInRuns } from './text'

describe('findInRuns', () => {
	it('finds text split across runs, as offsets into each', () => {
		const runs = ['Assets = Loan (L', ') | Owner', "'s stake (E)"]
		expect(findInRuns(runs, "Loan (L) | Owner's stake (E)")).toEqual([
			{ run: 0, start: 9, end: 16 },
			{ run: 1, start: 0, end: 9 },
			{ run: 2, start: 0, end: 12 },
		])
	})

	it('ignores whitespace and matches equivalent symbols', () => {
		expect(findInRuns(['∇f·u'], '∇f · u')).toEqual([{ run: 0, start: 0, end: 4 }])
		expect(findInRuns(['a − b'], 'a - b')).toEqual([{ run: 0, start: 0, end: 5 }])
	})

	it('matches KaTeX glyph runs loosely against LaTeX-ish queries', () => {
		// KaTeX renders D_u f as separate text nodes "D", "u", "f".
		expect(findInRuns(['D', 'u', 'f', '=', '∇', 'f'], 'D_u f')).toEqual([
			{ run: 0, start: 0, end: 1 },
			{ run: 1, start: 0, end: 1 },
			{ run: 2, start: 0, end: 1 },
		])
	})

	it('uses UTF-16 offsets around astral characters', () => {
		expect(findInRuns(['𝑥 + y'], 'y')).toEqual([{ run: 0, start: 5, end: 6 }])
	})

	it('returns null when absent', () => {
		expect(findInRuns(['Loan (L)'], 'Equity')).toBeNull()
		expect(containsText('Loan (L) | Owner’s stake (E)', "owner's stake")).toBe(true)
	})
})
