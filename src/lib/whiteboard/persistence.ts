import { createStore, get, set } from 'idb-keyval'
import {
	normalizeSnapshot,
	type TLStoreSnapshot,
	type TLCamera,
	type TLRecord
} from './model'
import { putBlob } from '@/lib/storage/blobs'
const loadedCheckpoints = new Map<string, string>()
let localStore: ReturnType<typeof createStore> | undefined
const db = () => (localStore ??= createStore('loci-documents', 'boards'))
export interface SavedBoard {
	snapshot: TLStoreSnapshot
	camera: TLCamera
	pageId?: string
}
function readDatabase(name: string): Promise<IDBDatabase | null> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(name)
		let absent = false
		req.onupgradeneeded = () => {
			absent = true
			req.transaction?.abort()
		}
		req.onerror = () => (absent ? resolve(null) : reject(req.error))
		req.onsuccess = () => resolve(req.result)
	})
}
function readEntries(
	database: IDBDatabase,
	store: string
): Promise<{ key: IDBValidKey; value: any }[]> {
	if (!database.objectStoreNames.contains(store)) return Promise.resolve([])
	return new Promise((resolve, reject) => {
		const values: { key: IDBValidKey; value: any }[] = []
		const req = database.transaction(store).objectStore(store).openCursor()
		req.onerror = () => reject(req.error)
		req.onsuccess = () => {
			const cursor = req.result
			if (cursor) {
				values.push({ key: cursor.key, value: cursor.value })
				cursor.continue()
			} else resolve(values)
		}
	})
}
async function readAll(database: IDBDatabase, store: string) {
	return (await readEntries(database, store)).map((entry) => entry.value)
}
/** Reads the legacy database without upgrading, deleting, or writing to it. */
export async function readLegacyBoard(
	key: string
): Promise<SavedBoard | undefined> {
	const legacy = await readDatabase(`TLDRAW_DOCUMENT_v2${key}`)
	if (!legacy) return undefined
	let records: TLRecord[], sessions: any[], assets: any[]
	try {
		;[records, sessions, assets] = await Promise.all([
			readAll(legacy, 'records'),
			readAll(legacy, 'session_state'),
			readEntries(legacy, 'assets')
		])
	} finally {
		legacy.close()
	}
	const store = Object.fromEntries(records.map((r) => [r.id, r]))
	const oldAssets = await readDatabase(`TLDRAW_ASSET_STORE_v1${key}`)
	if (oldAssets)
		try {
			assets.push(...(await readEntries(oldAssets, 'assets')))
		} finally {
			oldAssets.close()
		}
	for (const asset of assets) {
		const id = String(asset.key)
		const record = store[id]
		const blob =
			asset.value?.blob ??
			asset.value?.file ??
			(asset.value instanceof Blob ? asset.value : undefined)
		if (record?.typeName === 'asset' && blob instanceof Blob) {
			const blobKey = `canvas-asset-${key}-${id}`.replace(
				/[^a-zA-Z0-9_-]/g,
				'-'
			)
			await putBlob(blobKey, blob)
			store[id] = { ...record, props: { ...record.props, blobKey } }
		}
	}
	const session = sessions.sort((a, b) => b.updatedAt - a.updatedAt)[0]
		?.snapshot
	const page = session?.pageStates?.find(
		(p: any) => p.pageId === session.currentPageId
	)
	return {
		snapshot: normalizeSnapshot({ schema: {}, store }),
		camera: page?.camera ?? { x: 0, y: 0, z: 1 },
		pageId: session?.currentPageId
	}
}
export async function loadBoard(key: string): Promise<SavedBoard | undefined> {
	// A page can close before its queued IndexedDB transaction starts. Recover the
	// synchronous unload checkpoint first; saveBoard clears it once committed.
	try {
		const recovery = localStorage.getItem(`loci-board-recovery:${key}`)
		if (recovery) {
			const saved = JSON.parse(recovery) as SavedBoard
			if (saved.snapshot?.store && saved.camera) {
				loadedCheckpoints.set(key, recovery)
				return { ...saved, snapshot: normalizeSnapshot(saved.snapshot) }
			}
		}
	} catch {
		/* Storage may be disabled; the durable database is still usable. */
	}
	const saved = await get<SavedBoard>(key, db())
	return saved
		? { ...saved, snapshot: normalizeSnapshot(saved.snapshot) }
		: readLegacyBoard(key)
}
/** Synchronous checkpoint for unload; native assets remain in the blob store. */
export function checkpointBoard(key: string, value: SavedBoard) {
	localStorage.setItem(`loci-board-recovery:${key}`, JSON.stringify(value))
}
export async function saveBoard(key: string, value: SavedBoard) {
	await set(key, value, db())
	try {
		const recoveryKey = `loci-board-recovery:${key}`
		// An older queued write must not remove a newer unload checkpoint.
		const recovery = localStorage.getItem(recoveryKey)
		if (
			recovery &&
			(recovery === loadedCheckpoints.get(key) ||
				recovery === JSON.stringify(value))
		) {
			localStorage.removeItem(recoveryKey)
			loadedCheckpoints.delete(key)
		}
	} catch {
		/* IndexedDB succeeded, even when localStorage is unavailable. */
	}
}
