/**
 * Page images, pictures and replay audio, stored locally in IndexedDB. The board only references
 * them by key, which keeps the canvas document small. On a board saved to an account they are also
 * uploaded, and a key missing here (another device's upload) is fetched once and kept.
 */
import { createStore, del, get, set } from 'idb-keyval'
import { cloudBoard, fileUrl, uploadFile } from './cloud'

const store = typeof indexedDB !== 'undefined' ? createStore('loci-blobs', 'blobs') : undefined
const urls = new Map<string, string>()

export async function putBlob(key: string, blob: Blob) {
	await set(key, blob, store)
	const board = cloudBoard()
	if (board) void uploadFile(key, blob, board).catch(() => {})
}

export async function getBlob(key: string): Promise<Blob | undefined> {
	const local = await get<Blob>(key, store)
	if (local || !cloudBoard()) return local
	const res = await fetch(fileUrl(key)).catch(() => null)
	if (!res?.ok) return undefined
	const blob = await res.blob()
	await set(key, blob, store).catch(() => {})
	return blob
}

export async function deleteBlob(key: string) {
	const url = urls.get(key)
	if (url) URL.revokeObjectURL(url)
	urls.delete(key)
	await del(key, store)
}

/** An object URL for a stored blob, cached for the session. */
export async function getBlobUrl(key: string): Promise<string | undefined> {
	const cached = urls.get(key)
	if (cached) return cached
	const blob = await getBlob(key)
	if (!blob) return undefined
	const url = URL.createObjectURL(blob)
	urls.set(key, url)
	return url
}

export function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve(reader.result as string)
		reader.onerror = () => reject(reader.error)
		reader.readAsDataURL(blob)
	})
}

export function randomKey(prefix: string) {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
