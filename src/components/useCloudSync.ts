'use client'
import { useEffect, useState } from 'react'
import type { Editor, TLStoreSnapshot } from '@/lib/whiteboard'
import { CloudError, createBoard, loadBoard, pendingUploads, saveBoard, setCloudBoard } from '@/lib/storage/cloud'
import { loadConversation, saveConversation, type Turn } from '@/lib/storage/conversation'

export type SyncState = 'opening' | 'saved' | 'saving' | 'offline' | 'error' | 'missing' | 'signed-out'
/** What this browser's copy last agreed with: the account's version, and whether it has edits since. */
interface Meta { version: number; dirty: boolean }
const metaKey = (id: string) => `loci:cloud:${id}`
function readMeta(id: string): Meta {
	try { return JSON.parse(localStorage.getItem(metaKey(id)) || 'null') ?? { version: 0, dirty: false } } catch { return { version: 0, dirty: false } }
}
function writeMeta(id: string, meta: Meta) {
	try { localStorage.setItem(metaKey(id), JSON.stringify(meta)) } catch {}
}

/** One save at a time per board, across every mount in this tab, and the last body the account has. */
const inflight = new Map<string, Promise<unknown>>()
const lastSaved = new Map<string, string>()

const QUIET_MS = 2000
const MAX_WAIT_MS = 10000
const RETRY_MS = 15000

/**
 * Keep an account board in step with the account. The local copy opens instantly and keeps working
 * offline; edits save a moment after they stop. When another device saved first, this device's
 * edits become a separate board rather than overwriting the newer version.
 */
export function useCloudSync(editor: Editor, id: string) {
	const [state, setState] = useState<SyncState>('opening')
	const [ready, setReady] = useState(false)
	const [name, setName] = useState('')
	const [notice, setNotice] = useState('')

	useEffect(() => {
		let disposed = false
		let meta = readMeta(id)
		const refresh = () => { meta = readMeta(id) }
		let applying = false
		let edits = 0
		let firstEdit = 0
		let timer: ReturnType<typeof setTimeout> | undefined
		let saving: Promise<void> | null = null
		let blocked = false
		setCloudBoard(id)

		const persist = (next: Meta) => { meta = next; writeMeta(id, next) }
		const snapshot = () => editor.store.getStoreSnapshot('document')
		const apply = async (board: Awaited<ReturnType<typeof loadBoard>>) => {
			applying = true
			try {
				if (board.snapshot) editor.loadSnapshot(board.snapshot as TLStoreSnapshot)
				await saveConversation(board.conversation as Turn[], id)
			} finally { applying = false }
			persist({ version: board.version, dirty: false })
			lastSaved.set(id, body(snapshot(), board.conversation))
		}
		const body = (snap: unknown, conversation: unknown) => JSON.stringify({ snapshot: snap, conversation })
		/** This device's unsaved edits lost a race with another device: keep them as their own board. */
		const keepLocalCopy = async (boardName: string) => {
			try {
				const copy = await createBoard(`${boardName} (this device)`.slice(0, 80))
				await saveBoard(copy.id, { baseVersion: 0, snapshot: snapshot(), conversation: await loadConversation(id) })
				return true
			} catch { return false }
		}
		const takeNewer = async () => {
			const board = await loadBoard(id)
			const kept = await keepLocalCopy(board.name)
			await apply(board)
			setNotice(kept
				? 'This board changed on another device. Your edits here were saved as a separate board.'
				: 'This board changed on another device, so the newer version was loaded.')
		}

		const schedule = (delay?: number) => {
			if (disposed || blocked) return
			clearTimeout(timer)
			const wait = delay ?? Math.min(QUIET_MS, Math.max(0, MAX_WAIT_MS - (Date.now() - firstEdit)))
			timer = setTimeout(() => void save(), wait)
		}
		const save = (): Promise<void> => {
			if (saving) return saving
			saving = (async () => {
				// Another mount of this board may be mid-save; follow it, then read where it left off.
				await inflight.get(id)?.catch(() => {})
				refresh()
				const startEdits = edits
				try {
					// The saved board must not point at material that hasn't reached the account yet.
					await pendingUploads()
					const snap = snapshot()
					const conversation = await loadConversation(id)
					const content = body(snap, conversation)
					if (content === lastSaved.get(id)) {
						persist({ ...meta, dirty: edits !== startEdits })
					} else {
						setState('saving')
						const request = saveBoard(id, { baseVersion: meta.version, snapshot: snap, conversation })
						inflight.set(id, request)
						const version = await request.finally(() => { if (inflight.get(id) === request) inflight.delete(id) })
						lastSaved.set(id, content)
						persist({ version, dirty: edits !== startEdits })
					}
					if (!meta.dirty) firstEdit = 0
					setState('saved')
				} catch (err) {
					if (err instanceof CloudError && err.status === 409) { await takeNewer().catch(() => {}); setState('saved') }
					else if (err instanceof CloudError && err.status === 401) { blocked = true; setState('signed-out') }
					else if (err instanceof CloudError && err.status < 500) { blocked = true; setState('error'); setNotice(err.message) }
					else { setState('offline'); schedule(RETRY_MS) }
				} finally {
					saving = null
					if (meta.dirty && !blocked) schedule()
				}
			})()
			return saving
		}
		const edited = () => {
			if (applying || disposed) return
			edits++
			if (!firstEdit) firstEdit = Date.now()
			if (!meta.dirty) persist({ ...meta, dirty: true })
			schedule()
		}

		let unlisten = () => {}
		const onConversation = (e: Event) => { if ((e as CustomEvent).detail === id) edited() }
		const flush = () => { if (document.visibilityState === 'hidden' && meta.dirty) void save() }

		loadBoard(id).then(async (board) => {
			if (disposed) return
			setName(board.name)
			refresh()
			if (meta.dirty && meta.version === board.version) await save()
			else if (meta.dirty && meta.version < board.version) await takeNewer()
			else await apply(board)
			if (!disposed) setState('saved')
		}).catch((err) => {
			if (disposed) return
			if (err instanceof CloudError && err.status === 404) { setState('missing'); return }
			if (err instanceof CloudError && err.status === 401) { setState('signed-out'); return }
			// Offline: open the copy on this device and save once the account is reachable.
			setState('offline')
			if (meta.dirty) schedule(RETRY_MS)
		}).finally(() => {
			if (disposed) return
			unlisten = editor.store.listen(edited, { scope: 'document', source: 'all' })
			window.addEventListener('loci:conversation', onConversation)
			document.addEventListener('visibilitychange', flush)
			setReady(true)
		})

		return () => {
			disposed = true
			clearTimeout(timer)
			unlisten()
			window.removeEventListener('loci:conversation', onConversation)
			document.removeEventListener('visibilitychange', flush)
			if (meta.dirty && !blocked) void save()
			setCloudBoard(null)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [editor, id])

	return { ready, state, name, notice, dismissNotice: () => setNotice('') }
}
