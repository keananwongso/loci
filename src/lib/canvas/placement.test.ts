import { describe, expect, it } from 'vitest'
import { blocks, clearSpot, distance, overlaps, placeNear, placeRelative, type Rect } from './placement'

const page = { x: 0, y: 0, w: 600, h: 800 }

describe('placeRelative', () => {
	it('places to the right of a reference with a gap', () => {
		expect(placeRelative(page, { w: 100, h: 50 }, 'right', [page])).toEqual({ x: 648, y: 0 })
	})

	it('slides past the parent page when placed right of something inside it', () => {
		const highlight = { x: 100, y: 300, w: 80, h: 20 }
		const pos = placeRelative(highlight, { w: 300, h: 200 }, 'right', [page])
		expect(pos.y).toBe(300)
		expect(overlaps({ ...pos, w: 300, h: 200 }, page)).toBe(false)
	})

	it('slides past a chain of obstacles', () => {
		const graph = { x: 650, y: 0, w: 400, h: 400 }
		const pos = placeRelative(page, { w: 200, h: 100 }, 'right', [page, graph])
		expect(pos.x).toBeGreaterThanOrEqual(graph.x + graph.w)
	})

	it('stacks below with start alignment', () => {
		const graph = { x: 650, y: 0, w: 400, h: 400 }
		const eq = { x: 650, y: 448, w: 300, h: 60 }
		const pos = placeRelative(graph, { w: 200, h: 60 }, 'below', [page, graph, eq])
		expect(pos.x).toBe(650)
		expect(pos.y).toBeGreaterThanOrEqual(eq.y + eq.h)
	})
})

describe('placeNear', () => {
	const size = { w: 300, h: 120 }
	const free = (pos: { x: number; y: number }, obstacles: Rect[]) => obstacles.every((o) => !overlaps({ ...pos, ...size }, o))

	it('behaves like placeRelative when the space beside the reference is free', () => {
		expect(placeNear(page, size, 'right', [page])).toEqual(placeRelative(page, size, 'right', [page]))
	})

	it('still slides a note past the page a highlight sits on', () => {
		const highlight = { x: 100, y: 300, w: 80, h: 20 }
		expect(placeNear(highlight, size, 'right', [page])).toEqual({ x: 620, y: 300 })
	})

	it('stays beside the question when older notes fill the row to its right', () => {
		const question = { x: 2000, y: 0, w: 500, h: 400 }
		// A long row of notes from earlier turns, level with the question's top.
		const notes = Array.from({ length: 8 }, (_, i) => ({ x: 2548 + i * 420, y: 0, w: 400, h: 150 }))
		const obstacles = [page, question, ...notes]
		const pos = placeNear(question, size, 'right', obstacles)
		expect(free(pos, obstacles)).toBe(true)
		// Right of the question, under the first old note, not past the end of the row.
		expect(pos.x).toBe(2548)
		expect(distance({ ...pos, ...size }, question)).toBeLessThanOrEqual(100)
	})

	it('goes below the question when its right side is walled off', () => {
		const question = { x: 2000, y: 0, w: 500, h: 400 }
		const wall = Array.from({ length: 8 }, (_, i) => ({ x: 2548 + i * 420, y: -400, w: 400, h: 1400 }))
		const obstacles = [question, ...wall]
		const pos = placeNear(question, size, 'right', obstacles)
		expect(free(pos, obstacles)).toBe(true)
		expect(pos.y).toBeGreaterThanOrEqual(question.y + question.h)
		expect(pos.x).toBeLessThan(2548)
	})

	it('anchors at the material it is about, not at other questions on the board', () => {
		const loopInvariant = { x: 0, y: 0, w: 600, h: 500 }
		const markScheme = { x: 700, y: 0, w: 600, h: 800 }
		const pointerPuzzle = { x: 1400, y: 0, w: 500, h: 300 }
		// Notes from earlier turns crowd the space right of and below the pointer puzzle.
		const old = [
			{ x: 1948, y: 0, w: 600, h: 300 },
			{ x: 2600, y: 0, w: 600, h: 300 },
			{ x: 3250, y: 0, w: 600, h: 300 },
			{ x: 1400, y: 348, w: 500, h: 120 },
		]
		const obstacles = [loopInvariant, markScheme, pointerPuzzle, ...old]
		const pos = placeNear(pointerPuzzle, size, 'right', obstacles)
		expect(free(pos, obstacles)).toBe(true)
		expect(distance({ ...pos, ...size }, pointerPuzzle)).toBeLessThanOrEqual(250)
		expect(pos.x).toBeGreaterThanOrEqual(pointerPuzzle.x)
	})
})

describe('clearSpot', () => {
	// The "Stack: x, y, p1, p2 live here" box, and a short "points into" label put down on its top border.
	const box = { x: 700, y: 100, w: 300, h: 120, frame: true }
	const label = { x: 760, y: 90, w: 110, h: 26 }

	it('lifts a short label off a box border by the smallest slide', () => {
		const pos = clearSpot(label, [page, box])
		expect(pos).toEqual({ x: 760, y: box.y - 20 - label.h })
		expect(blocks({ ...pos, w: label.w, h: label.h }, box)).toBe(false)
	})

	it('leaves text that sits well inside a drawn box, or on clear board, where it is', () => {
		expect(clearSpot({ x: 740, y: 150, w: 110, h: 26 }, [page, box])).toEqual({ x: 740, y: 150 })
		expect(clearSpot({ x: 700, y: 400, w: 110, h: 26 }, [page, box])).toEqual({ x: 700, y: 400 })
	})

	it('moves text off the page and solid objects, even when fully inside them', () => {
		const pos = clearSpot({ x: 500, y: 300, w: 80, h: 26 }, [page])
		expect(overlaps({ ...pos, w: 80, h: 26 }, page)).toBe(false)
		expect(pos).toEqual({ x: 620, y: 300 })
	})
})
