import 'server-only'
import type { ActionSession } from '@/lib/tutor/session'
import type { TutorEvent } from '@/lib/tutor/types'
import type { TutorInput, TutorModelProvider } from './types'

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

	async run(input: TutorInput, session: ActionSession, _emit: (e: TutorEvent) => void, signal: AbortSignal) {
		const { board } = input.request
		const call = async (name: string, args: unknown) => {
			await sleep(450, signal)
			return session.handle(name, args)
		}
		const material =
			board.objects.find((o) => o.id === board.region?.materialId) ??
			board.objects.find((o) => board.selectedIds.includes(o.id) && o.material) ??
			board.objects.find((o) => o.material)

		if (!material) {
			await call('say', {
				text: 'Mock mode replays a scripted lesson on directional derivatives. Load the sample notes, select the page, and ask about $u$.',
			})
			return
		}

		const plane = board.objects.find((o) => o.id === 'dd-plane')
		if (!plane) {
			await call('say', {
				text: 'Good question. In $D_u f = \\nabla f \\cdot u$, the vector $u$ is not a point. It is a **direction**: the way you choose to walk away from your current point.',
			})
			const hl = await call('highlight', { id: 'hl-u', target: material.id, text: '∇f · u', style: 'marker', color: 'yellow' })
			if (!hl.ok) await call('highlight', { id: 'hl-u', target: material.id, region: { x: 0.1, y: 0.3, w: 0.4, h: 0.05 } })
			await call('say', {
				text: 'Picture the input plane. Every possible $u$ has length 1, so all of them end on the dashed unit circle.',
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
			await call('say', { text: 'The red arrow is the gradient: the direction of steepest increase. Now pick a direction $u$.' })
			await call('add_to_graph', {
				graphId: 'dd-plane',
				items: [
					{ kind: 'vector', id: 'u', to: [0.34, 0.94], label: 'u', color: 'blue' },
					{ kind: 'angle', id: 'theta', between: ['grad', 'u'], label: '\\theta', color: 'violet' },
				],
			})
			await call('draw_arrow', { id: 'arrow-u', from: { objectId: 'hl-u' }, to: { graphId: 'dd-plane', point: [0.34, 0.94] }, color: 'blue', bend: 30 })
			await call('say', {
				text: 'Because $|u| = 1$, the dot product only depends on the angle $\\theta$ between them:',
			})
			await call('write_equation', {
				id: 'eq-cos',
				latex: 'D_u f = \\nabla f \\cdot u = \\|\\nabla f\\|\\,\\cos\\theta',
				position: { relativeTo: 'dd-plane', placement: 'below', gap: 36 },
			})
			await call('say', {
				text: 'Quick check: if $u$ pointed in exactly the same direction as the red gradient, what would happen to $D_u f$?',
			})
			return
		}

		await call('say', {
			text: 'Look at the angle $\\theta$ in your diagram. The dot product measures how much of $\\nabla f$ lies along $u$.',
		})
		await call('add_to_graph', {
			graphId: 'dd-plane',
			items: [{ kind: 'projection', id: 'proj', of: 'grad', onto: 'u', label: '\\nabla f \\cdot u', color: 'blue' }],
		})
		await call('say', { text: 'That bold blue segment is the shadow of $\\nabla f$ on $u$. Rotate $u$ toward the gradient and the shadow grows.' })
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
			text: 'Since $\\cos\\theta \\le 1$, nothing beats $\\theta = 0$. Which direction would make $D_u f$ zero?',
		})
	}
}
