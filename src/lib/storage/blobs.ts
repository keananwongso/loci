/**
 * Page images and uploaded pictures, stored locally in IndexedDB (never uploaded anywhere).
 * The board only references them by key, which keeps the canvas document small.
 */
import { createStore, del, get, set } from 'idb-keyval'

const store = typeof indexedDB !== 'undefined' ? createStore('loci-blobs', 'blobs') : undefined
const urls = new Map<string, string>()

export async function putBlob(key: string, blob: Blob) {
	await set(key, blob, store)
}

export async function getBlob(key: string): Promise<Blob | undefined> {
	return get<Blob>(key, store)
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
