import { describe, expect, it } from 'vitest'
import { ocrItems, type OcrLine } from './ocr'
import { findTextBox, groupLines } from './text'

const word = (text: string, x0: number, x1: number, confidence = 90, y0 = 0, y1 = 0) => ({ text, confidence, bbox: { x0, y0, x1, y1 } })

// Two lines of a 1000×500 screenshot of C++ code.
const lines: OcrLine[] = [
	{ bbox: { x0: 100, y0: 100, x1: 600, y1: 130 }, words: [word('for', 100, 150, 92, 104, 126), word('(int', 160, 230), word('i', 240, 250), word('=', 260, 270), word('0;', 280, 310)] },
	{ bbox: { x0: 140, y0: 140, x1: 500, y1: 170 }, words: [word('sum', 140, 200), word('+=', 210, 240), word('a[i];', 250, 330), word('~', 340, 350, 12)] },
]

describe('ocrItems', () => {
	it('normalises word boxes to the image, taking the line top and height', () => {
		const items = ocrItems(lines, 1000, 500)
		// Each word but the last runs up to the next one, carrying the space between them.
		expect(items[0]).toEqual({ t: 'for ', b: [0.1, 0.2, 0.06, 0.06] })
		expect(items[4]).toEqual({ t: '0;', b: [0.28, 0.2, 0.03, 0.06] })
		expect(items[5]).toEqual({ t: 'sum ', b: [0.14, 0.28, 0.07, 0.06] })
	})

	it('drops low-confidence and empty words', () => {
		const items = ocrItems([{ bbox: lines[1].bbox, words: [...lines[1].words, word('  ', 360, 370)] }], 1000, 500)
		expect(items.map((i) => i.t)).toEqual(['sum ', '+= ', 'a[i];'])
	})

	it('reads back as lines and lets exact text be found like pdf text', () => {
		const items = ocrItems(lines, 1000, 500)
		expect(groupLines(items).map((l) => l.text)).toEqual(['for (int i = 0;', 'sum += a[i];'])
		const box = findTextBox(items, 'sum += a[i];')!
		expect(box.y).toBeLessThan(0.28)
		expect(box.y + box.h).toBeGreaterThan(0.34)
		expect(box.y + box.h).toBeLessThan(0.36)
		expect(box.x).toBeCloseTo(0.134, 3)
		expect(box.x + box.w).toBeCloseTo(0.336, 3)
	})
})
