import { describe, expect, it } from 'vitest'
import { overlaps, placeRelative } from './placement'

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
