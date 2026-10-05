import 'server-only'
import type { ActionSession } from '@/lib/tutor/session'
import type { TutorEvent } from '@/lib/tutor/types'
import type { TutorInput, TutorModelProvider } from './types'
import { ThoughtStream } from '@/lib/tutor/thoughts'

const sleep = (ms: number, signal: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		const t = setTimeout(resolve, ms)
		signal.addEventListener('abort', () => {
			clearTimeout(t)
			reject(new Error('aborted'))
		})
	})

/**
 * Development-only provider: replays a scripted lesson about directional derivatives through
 * the real validation and drawing pipeline, so the canvas can be developed without an API key.
 * It does not understand questions. Enable with LOCI_PROVIDER=mock.
 */
export class MockProvider implements TutorModelProvider {
	readonly name = 'mock'
	readonly model = 'scripted-demo'
	readonly setupHint = ''

	isConfigured() {
		return true
	}

	async run(input: TutorInput, session: ActionSession, emit: (e: TutorEvent) => void, signal: AbortSignal) {
		const { board } = input.request
		// Stream each call's arguments in pieces, like a real model, so the thought line updates.
		const thoughts = new ThoughtStream(emit)
		let calls = 0
		const call = async (name: string, args: unknown) => {
			const key = calls++
			const json = JSON.stringify(args)
			thoughts.update(key, { tool: name })
			const pieces = 3
			for (let i = 0; i < pieces; i++) {
				await sleep(150, signal)
				thoughts.update(key, { args: json.slice((json.length * i) / pieces, (json.length * (i + 1)) / pieces) })
			}
			return session.handle(name, args)
		}
		// A real model takes a moment before its first token.
		await sleep(700, signal)
		const material =
			board.objects.find((o) => o.id === board.region?.materialId) ??
			board.objects.find((o) => board.selectedIds.includes(o.id) && o.material) ??
			board.objects.find((o) => o.material)

		if (!material) {
			await call('say', {
				text: 'Mock mode replays a scripted lesson on directional derivatives. Load the sample notes, select the page, and ask about u.',
			})
			return
		}

		if (input.request.question.trim() === '/selftest') return selfTest(call, material.id)

		const plane = board.objects.find((o) => o.id === 'dd-plane')
		if (!plane) {
			await call('say', {
				text: "In this formula, u isn't a point. It's a direction, the way you choose to walk away from where you're standing.",
			})
			const hl = await call('highlight', { id: 'hl-u', target: material.id, text: '∇f · u', style: 'marker', color: 'yellow' })
			if (!hl.ok) await call('highlight', { id: 'hl-u', target: material.id, region: { x: 0.1, y: 0.3, w: 0.4, h: 0.05 } })
			await call('say', {
				text: 'Picture the input plane. Every possible u has length one, so they all end on this dashed circle.',
			})
			await call('draw_axes', {
				id: 'dd-plane',
				position: { relativeTo: material.id, placement: 'right', gap: 80 },
				width: 440,
				xRange: [-1.5, 3.5],
				yRange: [-1.5, 2.5],
				xLabel: 'x',
				yLabel: 'y',
				items: [
					{ kind: 'circle', id: 'unit-circle', center: [0, 0], radius: 1, dashed: true, color: 'grey', label: '|u| = 1' },
					{ kind: 'vector', id: 'grad', to: [2.4, 1.2], label: '\\nabla f', color: 'red' },
				],
			})
			await call('say', { text: "The red arrow is the gradient. It points uphill, the steepest way up. Now let's pick a direction u." })
			await call('add_to_graph', {
				graphId: 'dd-plane',
				items: [
					{ kind: 'vector', id: 'u', to: [0.34, 0.94], label: 'u', color: 'blue' },
					{ kind: 'angle', id: 'theta', between: ['grad', 'u'], label: '\\theta', color: 'violet' },
				],
			})
			await call('say', {
				text: "Since u has length one, the dot product only cares about the angle between them. That's theta.",
				look_at: { objectId: 'hl-u' },
			})
			await call('write_equation', {
				id: 'eq-cos',
				latex: 'D_u f = \\nabla f \\cdot u = \\|\\nabla f\\|\\,\\cos\\theta',
				position: { relativeTo: 'dd-plane', placement: 'below', gap: 36 },
			})
			await call('say', {
				text: 'Quick check. If u pointed the same way as the red arrow, what would happen to the slope?',
				look_at: { graphId: 'dd-plane', point: [2.4, 1.2] },
			})
			return
		}

		await call('say', {
			text: 'Look at the angle theta in your diagram. The dot product measures how much of the gradient lies along u.',
			look_at: { objectId: 'dd-plane' },
		})
		await call('say', { text: 'And this is the equation we wrote for it.', look_at: { objectId: 'eq-cos' } })
		await call('add_to_graph', {
			graphId: 'dd-plane',
			items: [{ kind: 'projection', id: 'proj', of: 'grad', onto: 'u', label: '\\nabla f \\cdot u', color: 'blue' }],
		})
		await call('say', { text: 'This bold blue piece is the shadow of the gradient on u. Turn u toward the gradient and the shadow grows.' })
		await call('add_to_graph', {
			graphId: 'dd-plane',
			items: [{ kind: 'vector', id: 'u-best', to: [0.894, 0.447], label: 'u^{*}', color: 'green' }],
		})
		await call('write_equation', {
			id: 'eq-max',
			latex: '\\theta = 0 \\;\\Rightarrow\\; \\cos\\theta = 1 \\;\\Rightarrow\\; D_u f = \\|\\nabla f\\|',
			position: { relativeTo: 'eq-cos', placement: 'below', gap: 24 },
			color: 'green',
		})
		await call('say', {
			text: "Cosine never goes above one, so nothing beats pointing straight at the gradient. Now, which direction would make the slope zero?",
		})
	}
}

type Call = (name: string, args: unknown) => Promise<{ ok: boolean }>

/** Exercises every tool once, for checking the executor visually. Type "/selftest" in mock mode. */
async function selfTest(call: Call, materialId: string) {
	const results: string[] = []
	const step = async (name: string, args: unknown) => {
		const r = await call(name, args)
		results.push(`${name}:${r.ok ? 'ok' : 'FAILED'}`)
	}
	await step('write_text', { id: 'st-note', text: 'Self test: every tool once', position: { relativeTo: materialId, placement: 'right', gap: 60 }, size: 'l' })
	await step('draw_axes', {
		id: 'st-graph',
		position: { relativeTo: 'st-note', placement: 'below', gap: 30 },
		xRange: [-3, 3],
		yRange: [-2, 4],
		width: 380,
		title: 'Plot check',
		items: [
			{ kind: 'function', id: 'parabola', expr: 'x^2 - 1', label: 'x^2 - 1', color: 'violet' },
			{ kind: 'function', id: 'wave', expr: 'sin(2x)', color: 'orange', dashed: true },
			{ kind: 'point', id: 'p', at: [1, 0], label: 'P' },
			{ kind: 'segment', id: 's', from: [-2, 3], to: [2, 3], label: '\\text{chord}', dashed: true },
			{ kind: 'label', id: 'lbl', at: [-2, -1.4], text: '\\text{min at } x=0' },
		],
	})
	await step('remove_from_graph', { graphId: 'st-graph', itemIds: ['wave'] })
	await step('write_equation', { id: 'st-eq', latex: '\\int_0^1 x^2\\,dx = \\tfrac{1}{3}', position: { relativeTo: 'st-graph', placement: 'right', gap: 40 }, size: 'l', color: 'blue' })
	await step('write_equation', { id: 'st-work-1', latex: '(x+1)^2 = (x+1)(x+1)', position: { relativeTo: 'st-graph', placement: 'below', gap: 40 } })
	await step('write_equation', { id: 'st-work-2', latex: '= x^2 + x + x + 1', position: { nextLineOf: 'st-work-1' } })
	await step('write_equation', { id: 'st-work-3', latex: '= x^2 + 2x + 1', position: { nextLineOf: 'st-work-2' }, color: 'green' })
	await step('draw_table', {
		id: 'st-table',
		position: { relativeTo: 'st-work-3', placement: 'below', gap: 40 },
		columns: ['statement', 'x', 'y', 'p1', 'p2'],
		rows: [
			['(1) p1 = &x;', '1', '2', '&x', null],
			['(2) *p1 = 5;', null, '2', null, null],
			['(3) p2 = p1;', null, null, null, null],
		],
		color: 'violet',
	})
	await step('update_table', { tableId: 'st-table', cells: [{ row: 1, col: 1, text: '5' }] })
	await step('highlight', { id: 'st-hl-cell', target: 'st-table', text: '&x', style: 'circle', color: 'green' })
	await step('draw_rectangle', { id: 'st-box', around: ['st-eq'], label: 'result', color: 'green' })
	await step('draw_circle', { id: 'st-ring', position: { relativeTo: 'st-eq', placement: 'below', gap: 60 }, width: 120, height: 70, label: 'ring', color: 'red', dashed: true })
	await step('draw_line', { id: 'st-line', from: { objectId: 'st-ring', side: 'left' }, to: { graphId: 'st-graph', point: [1, 0] }, color: 'grey', dashed: true })
	await step('draw_arrow', { id: 'st-arrow', from: { objectId: 'st-note', side: 'bottom' }, to: { objectId: 'st-eq', side: 'top' }, label: 'see', bend: 40 })
	await step('highlight', { id: 'st-hl-box', target: materialId, text: 'Definition', style: 'box', color: 'blue' })
	await step('highlight', { id: 'st-hl-under', target: materialId, text: 'unit vector', style: 'underline', color: 'pink' })
	await step('highlight', { id: 'st-hl-eq', target: 'st-eq', style: 'circle' })
	await step('move_object', { id: 'st-ring', position: { relativeTo: 'st-box', placement: 'below', gap: 30, align: 'center' } })
	await step('write_text', { id: 'st-temp', text: 'temporary', position: { x: 0, y: -200 } })
	await step('delete_objects', { ids: ['st-temp'] })
	await step('focus', { ids: ['st-graph', 'st-eq'] })
	await call('say', { text: `Self test finished: ${results.join(', ')}` })
}
