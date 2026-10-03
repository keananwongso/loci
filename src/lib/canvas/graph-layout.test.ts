import { describe, expect, it } from 'vitest'
import { layoutGraph, placeLabels, type GraphLabel } from './graph-layout'

describe('placeLabels', () => {
	it('moves a label off the line it would cover', () => {
		const ink: Array<[number, number]> = []
		for (let x = 0; x <= 200; x += 5) ink.push([x, 100])
		const label: GraphLabel = { key: 'a', x: 100, y: 100, latex: 'u', color: '#000', anchor: [100, 100] }
		placeLabels([label], ink, 200, 200)
		expect(Math.abs(label.y - 100)).toBeGreaterThan(10)
	})

	it('keeps vector labels clear of the vector and the axes', () => {
		const g = layoutGraph({
			w: 400, h: 400, xMin: -1, xMax: 2, yMin: -1, yMax: 2, grid: true, xLabel: 'x', yLabel: 'y',
			items: [
				{ kind: 'vector', id: 'u', to: [0.6, 0.8], label: 'u = (a, b)', color: 'blue' },
				{ kind: 'point', id: 'p', at: [0, 0], label: '(x_0, y_0)' },
			],
		} as never)
		const origin = g.labels.find((l) => l.key === 'p')!
		// The origin label must not sit on either axis (the axes cross at the anchor).
		expect(Math.abs(origin.x - origin.anchor![0]) > 12 && Math.abs(origin.y - origin.anchor![1]) > 8).toBe(true)
	})
})
