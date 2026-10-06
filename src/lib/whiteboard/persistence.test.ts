import 'fake-indexeddb/auto'
import { describe, it, expect, vi } from 'vitest'
import {
	readLegacyBoard,
	loadBoard,
	saveBoard,
	checkpointBoard
} from './persistence'
import { Editor } from './editor'
import { getBlob } from '@/lib/storage/blobs'
import {
	createLessonPlayback,
	type LessonRecording
} from '@/lib/storage/lesson'
const request = <T>(req: IDBRequest<T>) =>
	new Promise<T>((resolve, reject) => {
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error)
	})
async function legacy(key: string) {
	const open = indexedDB.open(`TLDRAW_DOCUMENT_v2${key}`, 4)
	open.onupgradeneeded = () => {
		for (const name of ['records', 'schema', 'session_state', 'assets'])
			open.result.createObjectStore(name)
	}
	return request(open)
}
async function fill(
	db: IDBDatabase,
	stores: Record<string, Record<string, unknown>>
) {
	const tx = db.transaction(Object.keys(stores), 'readwrite')
	for (const [name, values] of Object.entries(stores))
		for (const [key, value] of Object.entries(values))
			tx.objectStore(name).put(value, key)
	await new Promise<void>((resolve, reject) => {
		tx.oncomplete = () => resolve()
		tx.onerror = () => reject(tx.error)
	})
}

describe('legacy board interoperability', () => {
	it('imports raw keyed image assets and latest session without changing the original database', async () => {
		const key = 'legacy-fixture'
		const db = await legacy(key)
		const image = {
			id: 'asset:picture',
			typeName: 'asset',
			type: 'image',
			props: { src: 'asset:picture', name: 'picture.png' }
		}
		const shape = {
			id: 'shape:picture',
			typeName: 'shape',
			type: 'image',
			parentId: 'page:second',
			x: 10,
			y: 20,
			props: { assetId: image.id, w: 300, h: 200 }
		}
		await fill(db, {
			records: {
				[image.id]: image,
				[shape.id]: shape,
				'page:second': { id: 'page:second', typeName: 'page' }
			},
			assets: { [image.id]: new Blob(['pixel data'], { type: 'image/png' }) },
			session_state: {
				old: {
					id: 'old',
					updatedAt: 1,
					snapshot: {
						currentPageId: 'page:second',
						pageStates: [
							{ pageId: 'page:second', camera: { x: 0, y: 0, z: 1 } }
						]
					}
				},
				latest: {
					id: 'latest',
					updatedAt: 2,
					snapshot: {
						currentPageId: 'page:second',
						pageStates: [
							{ pageId: 'page:second', camera: { x: 50, y: -10, z: 2 } }
						]
					}
				}
			}
		})
		const imported = await readLegacyBoard(key)
		expect(imported?.snapshot.store[image.id].props.blobKey).toBe(
			'canvas-asset-legacy-fixture-asset-picture'
		)
		expect(
			await (
				await getBlob(imported!.snapshot.store[image.id].props.blobKey)
			)?.text()
		).toBe('pixel data')
		expect(imported?.camera).toEqual({ x: 50, y: -10, z: 2 })
		expect(imported?.pageId).toBe('page:second')
		expect(db.version).toBe(4)
		expect(
			await request(
				db.transaction('records').objectStore('records').get(image.id)
			)
		).toEqual(image)
		await saveBoard(key, { ...imported!, camera: { x: 100, y: 100, z: 0.5 } })
		expect((await loadBoard(key))?.camera.z).toBe(0.5)
		db.close()
	})
	it('leaves earlier standalone asset databases intact and reads their keys', async () => {
		const key = 'legacy-old-assets'
		const db = await legacy(key)
		await fill(db, {
			records: {
				'asset:old': {
					id: 'asset:old',
					typeName: 'asset',
					props: { src: 'asset:old' }
				}
			}
		})
		const open = indexedDB.open(`TLDRAW_ASSET_STORE_v1${key}`, 1)
		open.onupgradeneeded = () => open.result.createObjectStore('assets')
		const assets = await request(open)
		await fill(assets, {
			assets: { 'asset:old': new Blob(['old'], { type: 'image/png' }) }
		})
		const imported = await readLegacyBoard(key)
		expect(
			await (
				await getBlob(imported!.snapshot.store['asset:old'].props.blobKey)
			)?.text()
		).toBe('old')
		expect(
			await request(
				assets.transaction('assets').objectStore('assets').get('asset:old')
			)
		).toBeInstanceOf(Blob)
		assets.close()
		db.close()
	})
	it('plays legacy puts/removes through the new controller and resolves binding targets after each seek', () => {
		const e = new Editor()
		e.createShape({
			id: 'shape:target',
			type: 'geo',
			x: 100,
			y: 100,
			props: { w: 100, h: 80 }
		})
		e.createShape({ id: 'shape:arrow', type: 'arrow', x: 0, y: 0 })
		e.createBindings([
			{
				id: 'binding:end',
				fromId: 'shape:arrow',
				toId: 'shape:target',
				props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 } }
			}
		])
		const baseline = e.store.getStoreSnapshot()
		const target = { ...baseline.store['shape:target'], x: 300 }
		const lesson: LessonRecording = {
			version: 1,
			baseline: { schema: { schemaVersion: 2 }, store: baseline.store },
			camera: { x: 0, y: 0, z: 1 },
			duration: 300,
			cues: [],
			frames: [
				{ t: 100, put: [target], remove: [], camera: { x: 0, y: 0, z: 1 } },
				{
					t: 200,
					put: [],
					remove: ['shape:target'],
					camera: { x: 0, y: 0, z: 1 }
				}
			]
		}
		const play = createLessonPlayback(e, lesson)
		play(150)
		expect(e.arrowEnds(e.getShape('shape:arrow')!).end.x).toBe(350)
		play(250)
		expect(e.getShape('shape:target')).toBeUndefined()
		play(0)
		expect(e.arrowEnds(e.getShape('shape:arrow')!).end.x).toBe(150)
		expect(baseline.store['shape:target'].x).toBe(100)
		expect(e.getIsReadonly()).toBe(true)
	})
})

it('retains a migrated asset blob reference when the legacy account snapshot opens', () => {
	const editor = new Editor()
	const asset = {
		id: 'asset:local',
		typeName: 'asset',
		props: { src: 'asset:local', blobKey: 'canvas-asset-local' }
	}
	editor.loadSnapshot({ schema: { loci: 1 }, store: { [asset.id]: asset } })
	const legacy = {
		id: asset.id,
		typeName: 'asset',
		props: { src: 'asset:local' }
	}
	editor.loadSnapshot({
		schema: { schemaVersion: 2 },
		store: { [asset.id]: legacy }
	})
	expect(editor.resolveAsset(asset.id)?.props.blobKey).toBe(
		'canvas-asset-local'
	)
	expect(legacy.props).not.toHaveProperty('blobKey')
})

it('recovers an unload checkpoint before a stale durable snapshot and clears only matching committed checkpoints', async () => {
	const cache = new Map<string, string>()
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => cache.get(key) ?? null,
		setItem: (key: string, value: string) => cache.set(key, value),
		removeItem: (key: string) => cache.delete(key)
	})
	try {
		const key = 'unload-race'
		const initial = {
			snapshot: { schema: {}, store: {} },
			camera: { x: 0, y: 0, z: 1 }
		}
		await saveBoard(key, initial)
		const latest = { ...initial, camera: { x: 250, y: 80, z: 2 } }
		checkpointBoard(key, latest)
		await saveBoard(key, initial)
		expect((await loadBoard(key))?.camera).toEqual(latest.camera)
		expect(cache.size).toBe(1)
		await saveBoard(key, (await loadBoard(key))!)
		expect(cache.size).toBe(0)
		expect((await loadBoard(key))?.camera).toEqual(latest.camera)
	} finally {
		vi.unstubAllGlobals()
	}
})
