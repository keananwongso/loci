import { describe, expect, it } from 'vitest'
import { describeBoard } from './prompt'
import type { BoardContext, BoardObject } from './types'

const image = (id: string, name: string, x: number): BoardObject =>
	({
		id,
		type: 'image',
		author: 'user',
		bounds: { x, y: 0, w: 500, h: 300 },
		material: { kind: 'image', name, page: 1, pageCount: 1, pixelSize: [1000, 600] },
	}) as BoardObject

describe('describeBoard with several materials', () => {
	const board: BoardContext = {
		viewport: { x: 0, y: 0, w: 4000, h: 2000 },
		selectedIds: [],
		objects: [image('puzzle', 'pointers.png', 1400), image('loop', 'loop.png', 0)],
		focusIds: ['puzzle'],
	}

	it('lists the materials left to right and marks the one in focus', () => {
		const text = describeBoard(board)
		const loop = text.indexOf('- loop "loop.png"')
		const puzzle = text.indexOf('- puzzle "pointers.png"')
		expect(loop).toBeGreaterThan(-1)
		expect(puzzle).toBeGreaterThan(loop)
		expect(text).toMatch(/- puzzle "pointers.png" at \(1400, 0\) size 500×300 {2}← IN FOCUS/)
		expect(text).toContain('Nothing is selected')
	})

	it('leaves a board with one material as it was', () => {
		const text = describeBoard({ ...board, objects: [board.objects[0]] })
		expect(text).not.toContain('materials on the board')
	})
})
