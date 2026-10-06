'use client'
/**
 * Boards saved to a signed-in account. This browser keeps a working copy (tldraw's IndexedDB
 * persistence plus the local blob store) and the account holds the saved version, so a board
 * opens instantly here and on any other device.
 */

export interface CloudBoard { id: string; name: string; space_id: string | null; version: number; updated_at: string }
export interface CloudSpace { id: string; name: string; updated_at: string }
export interface CloudPlan { pro: boolean; boards: number; bytes: number; used: number }
export class CloudError extends Error {
	constructor(message: string, readonly status: number, readonly data: Record<string, unknown> = {}) { super(message) }
}

let active: string | null = null
/** The account board open in this tab; local saves of its files are mirrored to the account. */
export const setCloudBoard = (id: string | null) => { active = id }
export const cloudBoard = () => active

async function call<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, { cache: 'no-store', ...init, headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers })
	const data = await res.json().catch(() => ({}))
	if (!res.ok) throw new CloudError(data.error || 'Something went wrong. Try again.', res.status, data)
	return data as T
}

export const listBoards = () => call<{ boards: CloudBoard[]; spaces: CloudSpace[]; plan: CloudPlan }>('/api/boards')
export const createBoard = (name: string, spaceId?: string | null) =>
	call<{ board: CloudBoard }>('/api/boards', { method: 'POST', body: JSON.stringify({ name, spaceId }) }).then((r) => r.board)
export const loadBoard = (id: string) =>
	call<{ board: CloudBoard & { snapshot: unknown; conversation: unknown[] } }>(`/api/boards/${id}`).then((r) => r.board)
export const saveBoard = (id: string, body: { baseVersion: number; snapshot: unknown; conversation: unknown[] }) =>
	call<{ version: number }>(`/api/boards/${id}`, { method: 'PUT', body: JSON.stringify(body) }).then((r) => r.version)
export const updateBoard = (id: string, changes: { name?: string; spaceId?: string | null }) =>
	call<{ board: CloudBoard }>(`/api/boards/${id}`, { method: 'PATCH', body: JSON.stringify(changes) }).then((r) => r.board)
export const deleteBoard = (id: string) => call(`/api/boards/${id}`, { method: 'DELETE' })

/** Opening a file redirects to a short-lived signed URL in storage. */
export const fileUrl = (key: string) => `/api/files/${encodeURIComponent(key)}`

const uploads = new Map<string, Promise<void>>()
/** Upload straight to storage with a one-time URL, then confirm it so the account counts it. */
export function uploadFile(key: string, blob: Blob, boardId: string | null): Promise<void> {
	const run = async () => {
		const contentType = blob.type || 'application/octet-stream'
		const { uploadUrl } = await call<{ uploadUrl: string }>('/api/files', { method: 'POST', body: JSON.stringify({ key, boardId, bytes: blob.size, contentType }) })
		const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType, 'x-upsert': 'true' }, body: blob })
		if (!put.ok) throw new CloudError('The upload did not finish. Check your connection.', put.status)
		await call(`/api/files/${encodeURIComponent(key)}`, { method: 'POST' })
	}
	const upload = run()
	uploads.set(key, upload)
	upload.catch((err) => reportCloudError(err)).finally(() => uploads.delete(key))
	return upload
}

/** Files still uploading, so a save can wait for the material it refers to. */
export const pendingUploads = () => Promise.allSettled([...uploads.values()])

export function reportCloudError(err: unknown) {
	const message = err instanceof Error ? err.message : 'Could not save to your account.'
	window.dispatchEvent(new CustomEvent('loci:cloud-error', { detail: message }))
}
