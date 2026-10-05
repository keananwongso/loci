/**
 * Tables the tutor draws and the student fills in: cells, layout and keyboard navigation.
 * Pure (no editor), so the executor, the shape and the tests share one layout.
 */
import type { TableCell } from '@/lib/tutor/types'
import type { Rect } from './placement'

export const TABLE_FONT = 20
export const ROW_H = 40
export const CELL_PAD = 14
const MIN_COL = 44

export type Measure = (text: string) => number

/** Width of a line of text in the handwriting font (an estimate where there is no canvas). */
export const measureCell: Measure = (() => {
	let ctx: CanvasRenderingContext2D | null | undefined
	return (text: string) => {
		if (ctx === undefined) ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
		if (!ctx) return text.length * TABLE_FONT * 0.56
		ctx.font = `${TABLE_FONT}px loci-hand, sans-serif`
		return ctx.measureText(text).width
	}
})()

/** The tutor's rows as cells: null or "" is a blank left for the student. */
export function toCells(rows: (string | null)[][]): TableCell[][] {
	return rows.map((row) => row.map((t) => (t ? { text: t, by: 'tutor' } : { text: '', by: 'student' })))
}

/** Each column wide enough for its header and every cell (and at least its requested width). */
export function columnWidths(columns: string[], cells: TableCell[][], minW: number[] = [], measure: Measure = measureCell): number[] {
	return columns.map((head, c) => {
		const texts = [head, ...cells.map((row) => row[c]?.text ?? '')]
		const widest = Math.max(...texts.map((t) => (t ? measure(t) : 0)))
		return Math.ceil(Math.max(MIN_COL, minW[c] ?? 0, widest + CELL_PAD * 2))
	})
}

export function tableSize(colW: number[], rows: number) {
	return { w: colW.reduce((a, b) => a + b, 0), h: ROW_H * (rows + 1) }
}

/** A cell's box inside the table; row -1 is the header. */
export function cellRect(colW: number[], row: number, col: number): Rect {
	const x = colW.slice(0, col).reduce((a, b) => a + b, 0)
	return { x, y: (row + 1) * ROW_H, w: colW[col] ?? 0, h: ROW_H }
}

/**
 * The cell the student moves to from (row, col): `blank` looks for the next empty one (Enter),
 * otherwise any cell they can type in (Tab, or Shift+Tab with dir -1). Wraps; null if none.
 */
export function nextCell(cells: TableCell[][], row: number, col: number, dir: 1 | -1, blank = false): [number, number] | null {
	const cols = cells[0]?.length ?? 0
	const total = cells.length * cols
	const at = row * cols + col
	for (let i = 1; i < total; i++) {
		const k = (((at + dir * i) % total) + total) % total
		const cell = cells[Math.floor(k / cols)][k % cols]
		if (cell.by === 'student' && (!blank || !cell.text)) return [Math.floor(k / cols), k % cols]
	}
	return null
}

/** Find the cell holding `query` (exact first, then contained), header as row -1. */
export function findCell(columns: string[], cells: TableCell[][], query: string): [number, number] | null {
	const norm = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase()
	const q = norm(query)
	if (!q) return null
	const all: Array<[number, number, string]> = [
		...columns.map((t, c) => [-1, c, t] as [number, number, string]),
		...cells.flatMap((row, r) => row.map((cell, c) => [r, c, cell.text] as [number, number, string])),
	]
	const hit = all.find(([, , t]) => norm(t) === q) ?? all.find(([, , t]) => norm(t).includes(q))
	return hit ? [hit[0], hit[1]] : null
}

/**
 * The ruling as two SVG paths, slightly wobbly like a hand-drawn table: `light` between rows
 * and columns, `heavy` for the border and the line under the header. Seeded so it never shifts.
 */
export function gridPaths(colW: number[], rows: number, seed: string) {
	let s = 7
	for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) % 2147483647
	const j = (amp = 1.2) => {
		s = (s * 16807) % 2147483647
		return Math.round((s / 2147483647 - 0.5) * amp * 200) / 100
	}
	const seg = (x0: number, y0: number, x1: number, y1: number) =>
		`M${x0 + j()} ${y0 + j()} Q${(x0 + x1) / 2 + j(2)} ${(y0 + y1) / 2 + j(2)} ${x1 + j()} ${y1 + j()}`
	const { w, h } = tableSize(colW, rows)
	const light: string[] = []
	for (let r = 2; r <= rows; r++) light.push(seg(0, r * ROW_H, w, r * ROW_H))
	let x = 0
	for (const cw of colW.slice(0, -1)) {
		x += cw
		light.push(seg(x, 0, x, h))
	}
	const heavy = [seg(0, 0, w, 0), seg(w, 0, w, h), seg(w, h, 0, h), seg(0, h, 0, 0), seg(0, ROW_H, w, ROW_H)]
	return { light: light.join(' '), heavy: heavy.join(' ') }
}

/** The table as text for the tutor: blanks and what the student typed are marked. */
export function describeTable(columns: string[], rows: TableCell[][]): string[] {
	const esc = (t: string) => t.replace(/\|/g, '\\|')
	const cell = (c: TableCell) => (c.by === 'tutor' ? esc(c.text) : c.text ? `[student wrote: ${esc(c.text)}]` : '[blank]')
	return [`columns: ${columns.map(esc).join(' | ')}`, ...rows.map((row, r) => `row ${r}: ${row.map(cell).join(' | ')}`)]
}
