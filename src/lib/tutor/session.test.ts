import { describe, expect, it } from 'vitest'
import { ActionSession, MAX_CONNECTORS, MAX_MATERIAL_MARKS } from './session'
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

	it('does not silently draw guessed coordinates when a text match fails', () => {
		const { s, events } = session()
		const r = s.handle('highlight', {
			target: 'notes-p1', text: 'missing symbol', style: 'circle',
			region: { x: 0.7, y: 0.5, w: 0.1, h: 0.05 },
		})
		expect(r.ok).toBe(false)
		expect(events.some((e) => e.type === 'action')).toBe(false)
	})

	it('uses the supplied region hint to choose between repeated text matches', () => {
		const events: TutorEvent[] = []
		const repeated: BoardContext = {
			...board,
			objects: [{ ...board.objects[0], material: {
				...board.objects[0].material!,
				textItems: [
					{ t: 'variable t', b: [0.1, 0.2, 0.2, 0.03] },
					{ t: 'variable t', b: [0.1, 0.7, 0.2, 0.03] },
				],
			} }],
		}
		const s = new ActionSession(repeated, (e) => events.push(e))
		expect(s.handle('highlight', {
			target: 'notes-p1', text: 'variable t',
			region: { x: 0.1, y: 0.7, w: 0.2, h: 0.03 },
		}).ok).toBe(true)
		const ev = events.find((e) => e.type === 'action')
		expect(ev?.type === 'action' && ev.action.type === 'highlight' && ev.action.region?.y).toBeCloseTo(0.694)
	})

	it('highlights text inside the tutor\'s own writing by text, dropping any guessed region', () => {
		const { s, events } = session()
		s.handle('write_text', { id: 'plan', text: "Assets = Loan (L) + Owner's stake (E)", position: { x: 0, y: 0 } })
		const r = s.handle('highlight', { target: 'plan', text: "Loan (L) + Owner's stake (E)", region: { x: 0, y: 0, w: 0.5, h: 0.5 } })
		expect(r.ok).toBe(true)
		const ev = events.filter((e) => e.type === 'action').at(-1)
		expect(ev?.type === 'action' && ev.action.type === 'highlight' && [ev.action.text, ev.action.region]).toEqual(["Loan (L) + Owner's stake (E)", undefined])
	})

	it('fails a highlight on board text that does not contain the quote, showing the text', () => {
		const events: TutorEvent[] = []
		const withNote: BoardContext = {
			...board,
			objects: [...board.objects, { id: 'note-1', type: 'text', author: 'assistant', bounds: { x: 0, y: 900, w: 300, h: 40 }, text: 'Loan (L) | Owner’s stake (E)' }],
		}
		const s = new ActionSession(withNote, (e) => events.push(e))
		expect(s.handle('highlight', { target: 'note-1', text: "owner's stake" }).ok).toBe(true)
		const r = s.handle('highlight', { target: 'note-1', text: 'Equity' })
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.error).toMatch(/Loan \(L\)/)
	})

	it('leaves finding text in an equation to the rendered glyphs', () => {
		const { s } = session()
		s.handle('write_equation', { id: 'eq', latex: '\\nabla f \\cdot u', position: { x: 0, y: 0 } })
		expect(s.handle('highlight', { target: 'eq', text: '∇f' }).ok).toBe(true)
		expect(s.handle('highlight', { target: 'graph-1', text: 'x' }).ok).toBe(false)
	})

	it('asks for text read from an image to be quoted as read', () => {
		const ocr: BoardContext = {
			...board,
			objects: [{ id: 'code', type: 'image', author: 'user', bounds: { x: 0, y: 0, w: 600, h: 300 }, material: { kind: 'image', name: 'code.png', textItems: [{ t: 'sum', b: [0.1, 0.2, 0.05, 0.05] }, { t: '+=', b: [0.16, 0.2, 0.03, 0.05] }] } }],
		}
		const s = new ActionSession(ocr, () => {})
		expect(s.handle('highlight', { target: 'code', text: 'sum +=' }).ok).toBe(true)
		const r = s.handle('highlight', { target: 'code', text: 'total' })
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.error).toMatch(/read from the image/)
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

describe('mark budget', () => {
	const mark = (s: ActionSession, text: string) => s.handle('highlight', { target: 'notes-p1', text, style: 'circle' })

	it(`allows ${MAX_MATERIAL_MARKS} marks on the material per answer, then points back at them`, () => {
		const { s } = session()
		expect(mark(s, 'Directional').ok).toBe(true)
		expect(mark(s, '∇f · u').ok).toBe(true)
		const r = mark(s, 'derivative')
		expect(r.ok).toBe(false)
		expect(r.ok ? '' : r.error).toMatch(/already marked the material 2 times \(hl-1, hl-2\).*look_at.*"hl-1"/)
	})

	it("does not count failed matches or marks on the tutor's own work", () => {
		const { s } = session()
		expect(mark(s, 'not on the page').ok).toBe(false)
		expect(s.handle('highlight', { target: 'graph-1', style: 'circle' }).ok).toBe(true)
		expect(mark(s, 'Directional').ok).toBe(true)
		expect(mark(s, '∇f · u').ok).toBe(true)
	})

	it("frees a place when the tutor deletes one of this answer's marks", () => {
		const { s } = session()
		mark(s, 'Directional')
		mark(s, '∇f · u')
		expect(s.handle('delete_objects', { ids: ['hl-1'] }).ok).toBe(true)
		expect(mark(s, 'derivative').ok).toBe(true)
	})
})

describe('connectors', () => {
	it("refuses an arrow from the tutor's notes into the material or onto a mark on it", () => {
		const { s } = session()
		s.handle('highlight', { target: 'notes-p1', text: '∇f · u', style: 'circle' })
		s.handle('write_text', { id: 'note-far', text: 'points into', position: { relativeTo: 'graph-1', placement: 'below' } })
		const intoMark = s.handle('draw_arrow', { from: { objectId: 'note-far' }, to: { objectId: 'hl-1' } })
		expect(intoMark.ok).toBe(false)
		expect(intoMark.ok ? '' : intoMark.error).toMatch(/across the page.*look_at: \{ "objectId": "hl-1" \}/)
		expect(s.handle('draw_line', { from: { objectId: 'notes-p1' }, to: { objectId: 'graph-1' } }).ok).toBe(false)
		// A free point over the page counts as the page.
		expect(s.handle('draw_arrow', { from: { objectId: 'note-far' }, to: { x: 300, y: 400 } }).ok).toBe(false)
	})

	it("keeps arrows within the tutor's own work, up to a small cap", () => {
		const { s } = session()
		s.handle('write_text', { id: 'p1', text: 'p1', position: { relativeTo: 'graph-1', placement: 'below' } })
		for (let i = 0; i < MAX_CONNECTORS; i++) {
			expect(s.handle('draw_arrow', { from: { objectId: 'p1' }, to: { graphId: 'graph-1', point: [i, 0] } }).ok).toBe(true)
		}
		const r = s.handle('draw_arrow', { from: { objectId: 'p1' }, to: { objectId: 'graph-1' } })
		expect(r.ok).toBe(false)
		expect(r.ok ? '' : r.error).toMatch(/already has 3 arrows/)
	})

	it('allows a connector between two marks on the same page', () => {
		const { s } = session()
		s.handle('highlight', { target: 'notes-p1', text: 'Directional', style: 'circle' })
		s.handle('highlight', { target: 'notes-p1', text: '∇f · u', style: 'circle' })
		expect(s.handle('draw_arrow', { from: { objectId: 'hl-1' }, to: { objectId: 'hl-2' } }).ok).toBe(true)
	})

	it("treats highlights from earlier turns and the student's region as marks on their page", () => {
		const s = new ActionSession(
			{
				...board,
				region: { id: 'region-1', bounds: { x: 10, y: 10, w: 50, h: 50 }, materialId: 'notes-p1' },
				objects: [
					...board.objects,
					{ id: 'hl-old', type: 'highlight', author: 'assistant', parentId: 'notes-p1', bounds: { x: 60, y: 240, w: 100, h: 30 } },
					{ id: 'region-1', type: 'region', author: 'user', bounds: { x: 10, y: 10, w: 50, h: 50 } },
				],
			},
			() => {}
		)
		expect(s.handle('draw_arrow', { from: { objectId: 'graph-1' }, to: { objectId: 'hl-old' } }).ok).toBe(false)
		expect(s.handle('draw_arrow', { from: { objectId: 'region-1' }, to: { objectId: 'graph-1' } }).ok).toBe(false)
	})
})
