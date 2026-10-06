import { describe, it, expect } from 'vitest'
import { Editor } from './editor'
describe('grouped canvas edits', () => {
	it('keeps material annotations aligned through resize and undo', () => {
		const e = new Editor()
		e.createShape({
			id: 'shape:page',
			type: 'geo',
			x: 100,
			y: 100,
			props: { w: 200, h: 300 }
		})
		e.createShape({
			id: 'shape:mark',
			type: 'geo',
			parentId: 'shape:page',
			x: 20,
			y: 30,
			props: { w: 80, h: 40 }
		})
		e.clearHistory()
		e.markHistoryStoppingPoint('resize')
		e.resizeShape('shape:page', 400, 600)
		expect(e.getShape('shape:mark')?.x).toBe(40)
		expect(e.getShape('shape:mark')?.props.w).toBe(160)
		expect(e.getShapePageBounds('shape:mark')?.x).toBe(140)
		e.undo()
		expect(e.getShape('shape:mark')?.props.w).toBe(80)
	})
	it('groups and ungroups rotated shapes without moving their page geometry', () => {
		const e = new Editor()
		e.createShape({
			id: 'shape:a',
			type: 'geo',
			x: 100,
			y: 50,
			rotation: Math.PI / 2,
			props: { w: 100, h: 50 }
		})
		e.createShape({
			id: 'shape:b',
			type: 'geo',
			x: 300,
			y: 200,
			props: { w: 80, h: 30 }
		})
		const before = e.getShapePageBounds('shape:a')!
		e.groupShapes(['shape:a', 'shape:b'])
		const group = e.getOnlySelectedShapeId()!
		expect(e.getShapePageBounds('shape:a')).toEqual(before)
		e.updateShape({ id: group, x: e.getShape(group)!.x + 50 })
		expect(e.getShapePageBounds('shape:a')!.x).toBeCloseTo(before.x + 50)
		e.ungroupShapes([group])
		expect(e.getShapePageBounds('shape:a')!.x).toBeCloseTo(before.x + 50)
		expect(e.getShape('shape:a')?.parentId).toBe(e.pageId)
	})
	it('copies children, assets, and internal arrow bindings with fresh IDs and student metadata', () => {
		const e = new Editor()
		e.createShape({
			id: 'shape:box',
			type: 'geo',
			props: { w: 200, h: 100 },
			meta: { author: 'assistant', turn: 1 }
		})
		e.createShape({
			id: 'shape:mark',
			type: 'geo',
			parentId: 'shape:box',
			x: 20,
			y: 20
		})
		e.createShape({ id: 'shape:arrow', type: 'arrow' })
		e.createBindings([
			{
				fromId: 'shape:arrow',
				toId: 'shape:box',
				props: { terminal: 'end', normalizedAnchor: { x: 1, y: 1 } }
			}
		])
		e.select('shape:box', 'shape:arrow')
		const records = e.copyRecords()
		e.pasteRecords(records)
		expect(e.getCurrentPageShapes()).toHaveLength(6)
		const box = e.getSelectedShapes().find((s) => s.type === 'geo')!
		expect(box.id).not.toBe('shape:box')
		expect(box.meta.author).toBeUndefined()
		expect(
			e.getCurrentPageShapes().filter((s) => s.parentId === box.id)
		).toHaveLength(1)
		const arrow = e.getSelectedShapes().find((s) => s.type === 'arrow')!
		expect(e.getBindingsFromShape(arrow.id)[0].toId).toBe(box.id)
		e.undo()
		expect(e.getCurrentPageShapes()).toHaveLength(3)
	})
	it('never resurrects ask regions during undo, and canceling a tutor mark clears its redo branch', () => {
		const e = new Editor()
		e.createShape({ id: 'shape:a', type: 'geo' })
		e.clearHistory()
		e.createShape({ id: 'shape:region', type: 'loci-region' })
		const mark = e.markHistoryStoppingPoint('turn')
		e.updateShape({ id: 'shape:a', x: 100 })
		e.bailToMark(mark)
		e.redo()
		expect(e.getShape('shape:a')?.x).toBe(0)
		expect(e.getShape('shape:region')).toBeUndefined()
	})
})

describe('bounded history', () => {
	it('keeps only the last 100 edit steps and does not extend undo when canceling a mark', () => {
		const e = new Editor()
		e.createShape({ id: 'shape:a', type: 'geo' })
		e.clearHistory()
		for (let i = 1; i <= 150; i++) {
			e.markHistoryStoppingPoint('move')
			e.updateShape({ id: 'shape:a', x: i })
		}
		for (let i = 0; i < 150; i++) e.undo()
		expect(e.getShape('shape:a')?.x).toBe(50)
		for (let i = 0; i < 150; i++) e.redo()
		expect(e.getShape('shape:a')?.x).toBe(150)
		const mark = e.markHistoryStoppingPoint('cancel')
		e.updateShape({ id: 'shape:a', x: 999 })
		e.bailToMark(mark)
		expect(e.getShape('shape:a')?.x).toBe(150)
		e.undo()
		expect(e.getShape('shape:a')?.x).toBe(149)
	})
	it('drops expired marks without restoring old edits or retaining unlimited snapshots', () => {
		const e = new Editor()
		e.createShape({ id: 'shape:a', type: 'geo' })
		e.clearHistory()
		const expired = e.markHistoryStoppingPoint('old')
		for (let i = 1; i <= 150; i++) {
			e.markHistoryStoppingPoint('move')
			e.updateShape({ id: 'shape:a', x: i })
		}
		e.bailToMark(expired)
		expect(e.getShape('shape:a')?.x).toBe(150)
		expect(
			(e as unknown as { marks: Map<string, unknown> }).marks.size
		).toBeLessThanOrEqual(100)
	})
})
