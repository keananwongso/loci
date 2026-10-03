import { describe, expect, it } from 'vitest'
import { ActionSession } from './session'
import type { BoardContext, TutorEvent } from './types'
import { compileExpression, sampleFunction } from '@/lib/math/expr'
import { findTextBox, groupLines } from '@/lib/documents/text'
import { getToolDefinitions } from '@/lib/actions/tools'

// A synthetic page: one line "D_u f = ∇f · u" extracted as separate glyph runs, like pdf.js does.
const items = [
	{ t: 'Directional derivative', b: [0.1, 0.1, 0.4, 0.03] as [number, number, number, number] },
	{ t: 'D', b: [0.1, 0.3, 0.02, 0.03] as [number, number, number, number] },
	{ t: 'u', b: [0.12, 0.31, 0.01, 0.02] as [number, number, number, number] },
	{ t: 'f = ∇f · u', b: [0.14, 0.3, 0.2, 0.03] as [number, number, number, number] },
]

const board: BoardContext = {
	viewport: { x: 0, y: 0, w: 1200, h: 800 },
	selectedIds: ['notes-p1'],
	objects: [
		{
			id: 'notes-p1',
			type: 'pdf',
			author: 'user',
			bounds: { x: 0, y: 0, w: 640, h: 830 },
			material: { kind: 'pdf', name: 'notes.pdf', page: 1, pageCount: 1, textItems: items },
		},
		{
			id: 'graph-1',
			type: 'graph',
			author: 'assistant',
			bounds: { x: 700, y: 0, w: 400, h: 400 },
			graph: { xRange: [-1, 3], yRange: [-1, 3], items: [{ kind: 'vector', id: 'g', to: [2, 1] }] },
		},
	],
}

function session() {
	const events: TutorEvent[] = []
	return { s: new ActionSession(board, (e) => events.push(e)), events }
}

describe('ActionSession', () => {
	it('rejects unknown tools and malformed input', () => {
		const { s } = session()
		expect(s.handle('run_js', { code: 'alert(1)' }).ok).toBe(false)
		expect(s.handle('constructor', {}).ok).toBe(false)
		expect(s.handle('__proto__', {}).ok).toBe(false)
		expect(s.handle('write_equation', { latex: 'x', position: { x: NaN, y: 0 } }).ok).toBe(false)
		expect(s.handle('write_equation', { latex: 'x', position: { x: 1e9, y: 0 } }).ok).toBe(false)
		expect(s.handle('write_text', { text: 'hi', position: { x: 0, y: 0 }, onclick: 'x' }).ok).toBe(false)
	})

	it('rejects invalid LaTeX with a readable error', () => {
		const { s } = session()
		const r = s.handle('write_equation', { latex: '\\frac{1}{', position: { relativeTo: 'notes-p1', placement: 'right' } })
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.error).toMatch(/LaTeX/)
	})

	it('rejects references to ids that do not exist', () => {
		const { s } = session()
		const r = s.handle('write_text', { text: 'x', position: { relativeTo: 'nope', placement: 'right' } })
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.error).toMatch(/nope/)
	})

	it('assigns ids and lets later calls reference objects created earlier in the turn', () => {
		const { s, events } = session()
		const a = s.handle('write_equation', { latex: 'D_u f', position: { relativeTo: 'notes-p1', placement: 'right' } })
		expect(a.ok).toBe(true)
		const b = s.handle('write_text', { text: 'note', position: { relativeTo: 'eq-1', placement: 'below' } })
		expect(b.ok).toBe(true)
		expect(events.filter((e) => e.type === 'action')).toHaveLength(2)
	})

	it('de-duplicates requested ids', () => {
		const { s, events } = session()
		s.handle('write_text', { id: 'graph-1', text: 'x', position: { x: 0, y: 0 } })
		const ev = events.find((e) => e.type === 'action')
		expect(ev && ev.type === 'action' && 'id' in ev.action && ev.action.id).toBe('graph-2')
	})

	it('locates highlight text inside split pdf glyph runs', () => {
		const { s, events } = session()
		const r = s.handle('highlight', { target: 'notes-p1', text: '∇f · u' })
		expect(r.ok).toBe(true)
		const ev = events.find((e) => e.type === 'action')
		expect(ev?.type === 'action' && ev.action.type === 'highlight' && ev.action.region).toBeTruthy()
	})

	it('fails a highlight whose text is absent, listing the lines', () => {
		const { s } = session()
		const r = s.handle('highlight', { target: 'notes-p1', text: 'Lagrange multiplier' })
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.error).toMatch(/Directional derivative/)
	})

	it('validates graph items: angles need vectors, functions must parse', () => {
		const { s } = session()
		expect(s.handle('add_to_graph', { graphId: 'graph-1', items: [{ kind: 'angle', id: 'a', between: ['g', 'zzz'] }] }).ok).toBe(false)
		expect(s.handle('add_to_graph', { graphId: 'graph-1', items: [{ kind: 'function', id: 'f', expr: 'process.exit()' }] }).ok).toBe(false)
		expect(
			s.handle('add_to_graph', {
				graphId: 'graph-1',
				items: [
					{ kind: 'vector', id: 'u', to: [0, 1] },
					{ kind: 'angle', id: 'a', between: ['g', 'u'] },
				],
			}).ok
		).toBe(true)
	})

	it('only lets the tutor delete or move its own objects', () => {
		const { s } = session()
		expect(s.handle('delete_objects', { ids: ['notes-p1'] }).ok).toBe(false)
		expect(s.handle('delete_objects', { ids: ['graph-1'] }).ok).toBe(true)
	})

	it('rejects graphs with extreme aspect ratios', () => {
		const { s } = session()
		const r = s.handle('draw_axes', { position: { x: 0, y: 0 }, xRange: [0, 1], yRange: [0, 100] })
		expect(r.ok).toBe(false)
	})
})

describe('expression compiler', () => {
	it('evaluates standard math', () => {
		expect(compileExpression('x^2 - 1')(3)).toBe(8)
		expect(compileExpression('2x + 1')(2)).toBe(5)
		expect(compileExpression('sin(pi/2)')(0)).toBeCloseTo(1)
		expect(compileExpression('y = exp(-x^2/2)')(0)).toBe(1)
		expect(compileExpression('-x^2')(2)).toBe(-4)
	})
	it('refuses anything that is not math', () => {
		expect(() => compileExpression('constructor')).toThrow()
		expect(() => compileExpression('alert(1)')).toThrow()
		expect(() => compileExpression('x; 1')).toThrow()
	})
	it('splits samples at asymptotes', () => {
		const runs = sampleFunction(compileExpression('tan(x)'), -3, 3, [-5, 5])
		expect(runs.length).toBeGreaterThan(1)
	})
})

describe('pdf text helpers', () => {
	it('groups glyph runs into lines', () => {
		const lines = groupLines(items)
		expect(lines).toHaveLength(2)
		expect(lines[1].text.replace(/\s/g, '')).toBe('Duf=∇f·u')
	})
	it('finds LaTeX-ish queries loosely', () => {
		expect(findTextBox(items, 'D_u f = \\nabla f')).toBeNull() // \nabla is not the glyph ∇
		expect(findTextBox(items, 'D_u f = ∇f')).not.toBeNull()
	})
	it('treats look-alike math glyphs as equal', () => {
		const glyphs = [{ t: 'u = ⟨a, b⟩ with ∣u∣ = 1', b: [0.1, 0.2, 0.3, 0.02] as [number, number, number, number] }]
		expect(findTextBox(glyphs, '|u| = 1')).not.toBeNull()
		expect(findTextBox(glyphs, 'u = <a, b>')).not.toBeNull()
	})
})

describe('tool definitions', () => {
	it('produces object schemas for every tool', () => {
		for (const t of getToolDefinitions()) {
			expect(t.inputSchema.type).toBe('object')
			expect(JSON.stringify(t.inputSchema)).not.toContain('prefixItems')
		}
	})
})

describe('say look_at', () => {
	it('passes what the sentence is about through to the browser', () => {
		const { s, events } = session()
		expect(s.handle('say', { text: 'Look at the red vector.', look_at: { graphId: 'graph-1', point: [2, 1] } }).ok).toBe(true)
		expect(events).toEqual([{ type: 'say', text: 'Look at the red vector.', look: { graphId: 'graph-1', point: [2, 1] } }])
	})

	it('still speaks when it points at something that does not exist', () => {
		const { s, events } = session()
		const r = s.handle('say', { text: 'Look here.', look_at: { objectId: 'nope' } })
		expect(r).toMatchObject({ ok: true, result: expect.stringContaining('look_at ignored') })
		expect(events).toEqual([{ type: 'say', text: 'Look here.' }])
	})
})

describe('repeats', () => {
	it('catches the same opening sentence and near copies', async () => {
		const { repeats } = await import('./session')
		expect(repeats("I'm doing well, thanks. I see your notes are up.", "I'm doing well, thanks. Ready when you are.")).toBe(true)
		expect(repeats('The gradient points uphill, the steepest way up.', 'The gradient points uphill, the steepest way up from here.')).toBe(true)
	})

	it('lets different sentences that start alike through', async () => {
		const { repeats } = await import('./session')
		expect(repeats('Look at the red vector.', 'Look at the blue circle instead.')).toBe(false)
		expect(repeats('So f sub x is four.', 'So f sub y is thirteen.')).toBe(false)
	})

	it('drops the rest of a re-answer once it starts repeating', () => {
		const { s, events } = session()
		s.handle('say', { text: "I'm doing well, thanks. Your notes are up." })
		expect(s.handle('say', { text: "I'm doing well, thanks. Ready when you are." }).ok).toBe(false)
		expect(s.handle('say', { text: 'What would you like to focus on first?' }).ok).toBe(false)
		expect(s.handle('highlight', { target: 'notes-p1', text: '∇f · u' }).ok).toBe(true)
		expect(s.handle('say', { text: 'This is the line that matters.' }).ok).toBe(true)
		expect(events.filter((e) => e.type === 'say')).toHaveLength(2)
	})

	it('refuses to say the same thing twice in a turn', () => {
		const { s, events } = session()
		expect(s.handle('say', { text: "I'm doing well, thanks. Your notes are up." }).ok).toBe(true)
		expect(s.handle('say', { text: "I'm doing well, thanks. Ready when you are." }).ok).toBe(false)
		expect(events.filter((e) => e.type === 'say')).toHaveLength(1)
	})
})

describe('endsOnQuestion', () => {
	it('is true only once the last sentence asks something', () => {
		const { s } = session()
		s.handle('say', { text: "It's really a picture about two arrows. Let me draw it beside your notes." })
		expect(s.endsOnQuestion()).toBe(false)
		s.handle('say', { text: 'What happens if u points along the gradient?' })
		expect(s.endsOnQuestion()).toBe(true)
	})
})

describe('sayPlainText', () => {
	it('never speaks bracketed notes or tool calls written out as words', () => {
		const { s, events } = session()
		s.sayPlainText('So b is how far up u reaches. [Board actions I took: say look_at graph-u bvec ("So b..."), highlight hl-u2 on p1]')
		expect(events).toEqual([{ type: 'say', text: 'So b is how far up u reaches.' }])
	})

	it('says nothing when the text was only a bracketed note', () => {
		const { s, events } = session()
		s.sayPlainText('[Board actions I took: highlight hl-1]')
		expect(events).toEqual([])
	})
})

describe('graph range', () => {
	it('refuses a vector that runs past the axes, and says how to fix it', () => {
		const { s } = session()
		const r = s.handle('add_to_graph', { graphId: 'graph-1', items: [{ kind: 'vector', id: 'grad', from: [1, 2], to: [5, 15] }] })
		expect(r.ok).toBe(false)
		expect(r.ok ? '' : r.error).toMatch(/reaches \(5, 15\).*draw new axes/)
	})

	it('accepts items inside the range, with a little slack at the edges', () => {
		const { s } = session()
		expect(s.handle('add_to_graph', { graphId: 'graph-1', items: [{ kind: 'vector', id: 'u', to: [3.1, 1] }] }).ok).toBe(true)
	})
})
