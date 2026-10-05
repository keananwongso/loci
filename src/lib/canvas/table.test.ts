import { describe, expect, it } from 'vitest'
import { ActionSession } from '@/lib/tutor/session'
import { describeBoard } from '@/lib/tutor/prompt'
import type { BoardContext, TutorEvent } from '@/lib/tutor/types'
import { ROW_H, cellRect, columnWidths, describeTable, findCell, nextCell, tableSize, toCells } from './table'

const trace = {
	columns: ['statement', 'x', 'y', 'p1', 'p2'],
	rows: [
		['(1) p1 = &x;', '1', '2', '&x', null],
		['(2) *p1 = 5;', null, '', null, null],
	],
}

// The trace after the student typed into two of its blanks.
const filled = toCells(trace.rows)
filled[0][4] = { text: '&y', by: 'student' }
filled[1][1] = { text: '5', by: 'student' }

const board: BoardContext = {
	viewport: { x: 0, y: 0, w: 1200, h: 800 },
	selectedIds: [],
	objects: [
		{ id: 'trace', type: 'table', author: 'assistant', turn: 1, bounds: { x: 0, y: 0, w: 400, h: 120 }, table: { columns: trace.columns, rows: filled } },
	],
}

function session() {
	const events: TutorEvent[] = []
	return { s: new ActionSession(board, (e) => events.push(e)), events }
}

describe('draw_table', () => {
	it('draws a table with blanks and assigns an id', () => {
		const { s, events } = session()
		const r = s.handle('draw_table', { position: { relativeTo: 'trace', placement: 'below' }, ...trace })
		expect(r.ok).toBe(true)
		expect(r.ok && r.result).toMatch(/table-1.*5 blank/)
		const ev = events.find((e) => e.type === 'action')
		expect(ev?.type === 'action' && ev.summary).toMatch(/draw_table table-1: statement \| x .*2 rows \(with blanks/)
	})

	it('rejects rows that do not match the header, and mismatched widths', () => {
		const { s } = session()
		const short = s.handle('draw_table', { position: { x: 0, y: 0 }, columns: ['a', 'b'], rows: [['1', '2'], ['3']] })
		expect(short.ok ? '' : short.error).toMatch(/Row 1 has 1 cells but there are 2 columns/)
		const widths = s.handle('draw_table', { position: { x: 0, y: 0 }, columns: ['a', 'b'], rows: [['1', '2']], widths: [80] })
		expect(widths.ok ? '' : widths.error).toMatch(/widths/)
	})

	it('caps columns, rows and cell length', () => {
		const { s } = session()
		const pos = { x: 0, y: 0 }
		expect(s.handle('draw_table', { position: pos, columns: Array(9).fill('c'), rows: [Array(9).fill('1')] }).ok).toBe(false)
		expect(s.handle('draw_table', { position: pos, columns: ['a'], rows: Array(17).fill(['1']) }).ok).toBe(false)
		expect(s.handle('draw_table', { position: pos, columns: ['a'], rows: [['x'.repeat(61)]] }).ok).toBe(false)
		expect(s.handle('draw_table', { position: pos, columns: ['a'], rows: [] }).ok).toBe(false)
	})
})

describe('update_table', () => {
	it('fills and clears cells of a table on the board', () => {
		const { s } = session()
		const r = s.handle('update_table', { tableId: 'trace', cells: [{ row: 1, col: 2, text: '2' }, { row: 0, col: 3, text: null }] })
		expect(r.ok).toBe(true)
	})

	it('refuses cells outside the table, and non-tables', () => {
		const { s } = session()
		const out = s.handle('update_table', { tableId: 'trace', cells: [{ row: 2, col: 0, text: 'x' }] })
		expect(out.ok ? '' : out.error).toMatch(/outside trace.*rows 0\.\.1/)
		s.handle('write_text', { id: 'note', text: 'hi', position: { x: 0, y: 0 } })
		expect(s.handle('update_table', { tableId: 'note', cells: [{ row: 0, col: 0, text: 'x' }] }).ok).toBe(false)
	})

	it('knows tables drawn earlier in the same turn', () => {
		const { s } = session()
		s.handle('draw_table', { id: 'tt', position: { x: 0, y: 0 }, columns: ['p', 'q'], rows: [['T', null]] })
		expect(s.handle('update_table', { tableId: 'tt', cells: [{ row: 0, col: 1, text: 'F' }] }).ok).toBe(true)
	})
})

describe('highlight on a table', () => {
	const cellOf = (events: TutorEvent[]) => {
		const ev = events.findLast((e) => e.type === 'action')
		return ev?.type === 'action' && ev.action.type === 'highlight' ? ev.action.cell : undefined
	}

	it('finds the cell holding the quoted text, including what the student typed', () => {
		const { s, events } = session()
		expect(s.handle('highlight', { target: 'trace', text: '*p1 = 5', style: 'circle' }).ok).toBe(true)
		expect(cellOf(events)).toEqual({ row: 1, col: 0 })
		expect(s.handle('highlight', { target: 'trace', text: '&y' }).ok).toBe(true)
		expect(cellOf(events)).toEqual({ row: 0, col: 4 })
		expect(s.handle('highlight', { target: 'trace', text: 'p2' }).ok).toBe(true)
		expect(cellOf(events)).toEqual({ row: -1, col: 4 })
	})

	it('explains a miss and refuses cells outside the table', () => {
		const { s } = session()
		const miss = s.handle('highlight', { target: 'trace', text: 'zzz' })
		expect(miss.ok ? '' : miss.error).toMatch(/Could not find "zzz" in table trace/)
		expect(s.handle('highlight', { target: 'trace', cell: { row: 5, col: 0 } }).ok).toBe(false)
		expect(s.handle('highlight', { target: 'trace', cell: { row: 1, col: 4 } }).ok).toBe(true)
	})
})

describe('table text for the tutor', () => {
	it('lists every cell, marking blanks and what the student wrote', () => {
		expect(describeTable(trace.columns, filled)).toEqual([
			'columns: statement | x | y | p1 | p2',
			'row 0: (1) p1 = &x; | 1 | 2 | &x | [student wrote: &y]',
			'row 1: (2) *p1 = 5; | [student wrote: 5] | [blank] | [blank] | [blank]',
		])
		expect(describeTable(['a|b'], [[{ text: 'x|y', by: 'tutor' }]])).toEqual(['columns: a\\|b', 'row 0: x\\|y'])
	})

	it('appears in the board description', () => {
		const text = describeBoard(board)
		expect(text).toMatch(/- trace \[table\] by you \(turn 1\)/)
		expect(text).toMatch(/row 1: \(2\) \*p1 = 5; \| \[student wrote: 5\]/)
	})
})

describe('table layout', () => {
	const measure = (t: string) => t.length * 10

	it('fits each column to its widest text, and honours minimum widths', () => {
		const cells = toCells([['abcdefghij', null]])
		const w = columnWidths(['a', 'b'], cells, [], measure)
		expect(w[0]).toBe(100 + 28)
		expect(w[1]).toBeGreaterThanOrEqual(44)
		expect(columnWidths(['a', 'b'], cells, [0, 200], measure)[1]).toBe(200)
		cells[0][1] = { text: 'x'.repeat(30), by: 'student' }
		expect(columnWidths(['a', 'b'], cells, [0, 200], measure)[1]).toBe(328)
	})

	it('places cells below the header', () => {
		expect(cellRect([100, 50, 70], 0, 2)).toEqual({ x: 150, y: ROW_H, w: 70, h: ROW_H })
		expect(cellRect([100, 50], -1, 1)).toEqual({ x: 100, y: 0, w: 50, h: ROW_H })
		expect(tableSize([100, 50], 3)).toEqual({ w: 150, h: ROW_H * 4 })
	})
})

describe('nextCell', () => {
	const cells = toCells([
		['a', null, 'b'],
		[null, 'c', null],
	])
	cells[1][0] = { text: 'typed', by: 'student' }

	it('Tab visits every cell the student can type in, wrapping', () => {
		expect(nextCell(cells, 0, 1, 1)).toEqual([1, 0])
		expect(nextCell(cells, 1, 0, 1)).toEqual([1, 2])
		expect(nextCell(cells, 1, 2, 1)).toEqual([0, 1])
		expect(nextCell(cells, 0, 1, -1)).toEqual([1, 2])
	})

	it('Enter skips cells that are already filled', () => {
		expect(nextCell(cells, 0, 1, 1, true)).toEqual([1, 2])
		expect(nextCell(toCells([['a', null]]), 0, 1, 1, true)).toBeNull()
	})

	it('finds cells by their text', () => {
		expect(findCell(['x'], toCells([['p = 1'], ['q']]), ' Q ')).toEqual([1, 0])
		expect(findCell(['x'], toCells([['p = 1']]), 'p =')).toEqual([0, 0])
		expect(findCell(['x'], toCells([['p']]), 'nope')).toBeNull()
	})
})
