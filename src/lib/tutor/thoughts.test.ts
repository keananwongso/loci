import { describe, expect, it } from 'vitest'
import { ThoughtStream, thoughtFor } from './thoughts'
import type { TutorEvent } from './types'

describe('thoughtFor', () => {
	it('never shows what the tutor is about to say', () => {
		expect(thoughtFor('say', '{"text":"u is a direction"}')).toBeNull()
	})

	it('waits for a string to finish streaming before quoting it', () => {
		expect(thoughtFor('highlight', '{"target":"p1","text":"∇f · ')).toEqual({ text: 'finding the spot in your notes' })
		expect(thoughtFor('highlight', '{"target":"p1","text":"∇f · u"')).toEqual({ text: 'finding “∇f · u”' })
	})

	it('decodes escaped LaTeX', () => {
		expect(thoughtFor('write_equation', '{"latex":"D_u f = \\\\nabla f \\\\cdot u"')).toEqual({ text: 'writing', latex: 'D_u f = \\nabla f \\cdot u' })
	})

	it('follows the graph item being written', () => {
		const args = '{"id":"g","xRange":[-2,2],"items":[{"kind":"circle","id":"c","radius":1},{"kind":"vector","id":"u","to":[0.3,0.9],"label":"u"'
		expect(thoughtFor('draw_axes', args)).toEqual({ text: 'drawing the vector', latex: 'u' })
		expect(thoughtFor('draw_axes', '{"id":"g","position"')).toEqual({ text: 'setting up axes' })
		expect(thoughtFor('add_to_graph', '{"graphId":"g","items":[{"kind":"function","expr":"x^2 - 1"')).toEqual({ text: 'plotting y = x^2 - 1' })
	})

	it('ignores x and y axis labels when reading a label', () => {
		expect(thoughtFor('draw_axes', '{"xLabel":"x","yLabel":"y"')).toEqual({ text: 'setting up axes' })
	})
})

describe('ThoughtStream', () => {
	it('emits only when the line changes', () => {
		const events: TutorEvent[] = []
		const thoughts = new ThoughtStream((e) => events.push(e))
		thoughts.update(0, { tool: 'highlight' })
		thoughts.update(0, { args: '{"target":"p1",' })
		thoughts.update(0, { args: '"text":"cos θ"}' })
		thoughts.update(1, { tool: 'say', args: '{"text":"hi"}' })
		expect(events).toEqual([
			{ type: 'thought', text: 'finding the spot in your notes' },
			{ type: 'thought', text: 'finding “cos θ”' },
		])
	})
})
