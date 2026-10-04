import { describe, expect, it } from 'vitest'
import { lineClip } from './writing-layout'

describe('line-by-line writing clip', () => {
	it('reveals the current row while keeping completed rows visible and later rows hidden', () => {
		const line = { x: 0, y: 0.25, w: 0.8, h: 0.25 }
		expect(lineClip(line, 0)).toBe('polygon(-2% -20%, 102% -20%, 102% 25%, 0% 25%, 0% 50%, -2% 50%)')
		expect(lineClip(line, 0.5)).toBe('polygon(-2% -20%, 102% -20%, 102% 25%, 40% 25%, 40% 50%, -2% 50%)')
		expect(lineClip(line, 1)).toContain('80% 50%')
	})

	it('allows glyph padding without moving the pen path', () => {
		const line = { x: 0, y: 0, w: 1, h: 0.2, clipTop: -0.2, clipBottom: 0.25 }
		expect(lineClip(line, 1)).toContain('100% -20%, 100% 25%')
		expect(line.y).toBe(0)
	})
})
