import { describe, it, expect } from 'vitest'
import { Editor } from './editor'
import {
	decodeStroke,
	normalizeSnapshot,
	strokePoints,
	toRichText,
	type TLShape
} from './model'

describe('owned canvas document', () => {
	it('stops shape ancestry at page records restored from a saved board', () => {
		const e = new Editor()
		e.store.put([{ id: e.pageId, typeName: 'page' }])
		e.createShape({ id: 'shape:parent', type: 'group' })
		e.createShape({ id: 'shape:child', type: 'geo', parentId: 'shape:parent' })
		const parent = e.getShape('shape:parent')!
		const child = e.getShape('shape:child')!
		expect(e.getShape(e.pageId)).toBeUndefined()
		expect(e.getShapeParent(parent)).toBeUndefined()
		expect(e.getShapeAncestors(parent)).toEqual([])
		expect(e.getShapeAncestors(child)).toEqual([parent])
		expect(e.isShapeOrAncestorLocked(child)).toBe(false)
		expect(e.getCurrentPageShapes()).toEqual([parent, child])
		e.updateShape({ id: parent.id, isLocked: true })
		expect(e.isShapeOrAncestorLocked(child)).toBe(true)
	})
	it('restores a tutor turn that edits an existing graph and removes a shape', () => {
		const e = new Editor()
		e.createShape({
			id: 'shape:graph',
			type: 'loci-graph',
			props: { w: 300, h: 200, items: [{ id: 'curve', value: 1 }] }
		})
		e.createShape({
			id: 'shape:text',
			type: 'text',
			props: { richText: toRichText('original') }
		})
		const baseline = e.store.getStoreSnapshot()
		const mark = e.markHistoryStoppingPoint('tutor turn')
		e.updateShape({
			id: 'shape:graph',
			props: { items: [{ id: 'curve', value: 2 }] }
		})
		e.deleteShapes(['shape:text'])
		e.createShape({ id: 'shape:answer', type: 'geo' })
		e.bailToMark(mark)
		expect(e.records).toEqual(baseline.store)
		expect(e.records['shape:graph'].props.items[0].value).toBe(1)
	})
	it('groups a drag into one undo step, and keeps transient camera/selection out of history', () => {
		const e = new Editor()
		e.createShape({ id: 'shape:box', type: 'geo', x: 10, y: 20 })
		e.clearHistory()
		e.markHistoryStoppingPoint('drag')
		for (let x = 11; x <= 100; x++) e.updateShape({ id: 'shape:box', x })
		e.select('shape:box')
		e.setCamera({ x: 40, y: 50, z: 2 })
		e.undo()
		expect(e.getShape('shape:box')?.x).toBe(10)
		expect(e.camera.z).toBe(2)
		e.redo()
		expect(e.getShape('shape:box')?.x).toBe(100)
	})
	it('transforms child geometry and bound arrows through rotated parents', () => {
		const e = new Editor()
		e.createShape({
			id: 'shape:parent',
			type: 'geo',
			x: 100,
			y: 50,
			rotation: Math.PI / 2,
			props: { w: 100, h: 100 }
		})
		e.createShape({
			id: 'shape:child',
			type: 'geo',
			parentId: 'shape:parent',
			x: 10,
			y: 20,
			props: { w: 40, h: 30 }
		})
		e.createShape({ id: 'shape:arrow', type: 'arrow', x: 0, y: 0 })
		const box = e.getShapePageBounds('shape:child')!
		expect(box.x).toBeCloseTo(50)
		expect(box.y).toBeCloseTo(60)
		expect(box.w).toBeCloseTo(30)
		expect(box.h).toBeCloseTo(40)
		e.createBindings([
			{
				fromId: 'shape:arrow',
				toId: 'shape:child',
				props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 } }
			}
		])
		expect(e.arrowEnds(e.getShape('shape:arrow')!).end.x).toBeCloseTo(65)
		expect(e.arrowEnds(e.getShape('shape:arrow')!).end.y).toBeCloseTo(80)
		e.updateShape({ id: 'shape:parent', x: 200 })
		expect(e.arrowEnds(e.getShape('shape:arrow')!).end.x).toBeCloseTo(165)
	})
	it('keeps unknown legacy records and assets without modifying the source snapshot', () => {
		const source = {
			schema: { schemaVersion: 2 },
			store: {
				'shape:future': {
					id: 'shape:future',
					typeName: 'shape',
					type: 'future-widget',
					props: { value: 42 }
				},
				'asset:one': {
					id: 'asset:one',
					typeName: 'asset',
					props: { src: 'data:image/png;base64,test' }
				}
			}
		}
		const converted = normalizeSnapshot(source)
		expect(converted.schema).toEqual({ loci: 1 })
		expect(converted.store['shape:future'].props.value).toBe(42)
		expect(source.store['shape:future']).not.toHaveProperty('x')
		expect(converted.store['asset:one']).toEqual(source.store['asset:one'])
	})
	it('decodes binary delta strokes with 2D pressure and reflected/scaled coordinates', () => {
		const bytes = new Uint8Array(12),
			v = new DataView(bytes.buffer)
		v.setFloat32(0, 10, true)
		v.setFloat32(4, 20, true)
		v.setUint16(8, 0x3c00, true)
		v.setUint16(10, 0xc000, true)
		const path = btoa(String.fromCharCode(...bytes))
		expect(decodeStroke(path, 2)).toEqual([
			[10, 20, 0.5],
			[11, 18, 0.5]
		])
		const shape = {
			props: { segments: [{ path, dim: 2 }], scaleX: -2, scaleY: 3 }
		} as unknown as TLShape
		expect(strokePoints(shape)).toEqual([
			[-20, 60, 0.5],
			[-22, 54, 0.5]
		])
		expect(() => decodeStroke('AA==', 3)).toThrow()
	})
	it('keeps remote lesson diffs out of undo and sends one notification for a transaction', () => {
		const e = new Editor()
		let events = 0
		e.store.listen(() => events++, { scope: 'document' })
		e.run(() => {
			e.createShape({ id: 'shape:a', type: 'geo' })
			e.createShape({ id: 'shape:b', type: 'geo' })
		})
		expect(events).toBe(1)
		e.clearHistory()
		e.store.mergeRemoteChanges(() => e.store.remove(['shape:a']))
		e.undo()
		expect(e.getShape('shape:a')).toBeUndefined()
	})
	it('uses container offsets and zoom consistently for camera conversion', () => {
		const e = new Editor()
		e.camera = { x: -100, y: 30, z: 2 }
		e.container = {
			getBoundingClientRect: () => ({ x: 20, y: 40, width: 800, height: 600 })
		} as HTMLElement
		const viewport = e.pageToViewport({ x: 150, y: 20 })
		expect(viewport).toEqual({ x: 100, y: 100 })
		expect(e.screenToPage({ x: viewport.x + 20, y: viewport.y + 40 })).toEqual({
			x: 150,
			y: 20
		})
	})
})
