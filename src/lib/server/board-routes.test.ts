import { beforeEach, describe, expect, it, vi } from 'vitest'

type Op = [string, unknown[]]
type Result = { data?: unknown; error?: unknown; count?: number }
/** A stand-in for supabase-js that records every query and answers from per-table handlers. */
const db = vi.hoisted(() => {
	const state = {
		queries: [] as { table: string; ops: Op[] }[],
		tables: {} as Record<string, (ops: Op[]) => Result>,
		rpc: (() => ({ data: null, error: null })) as (name: string, args: Record<string, unknown>) => Result,
		storage: { createSignedUploadUrl: vi.fn(), createSignedUrl: vi.fn(), info: vi.fn(), remove: vi.fn() },
	}
	const from = (table: string) => {
		const query = { table, ops: [] as Op[] }
		state.queries.push(query)
		const builder: object = new Proxy({}, {
			get: (_, prop) => prop === 'then'
				? (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) => Promise.resolve({ data: null, error: null, ...state.tables[table]?.(query.ops) }).then(resolve, reject)
				: (...args: unknown[]) => { query.ops.push([String(prop), args]); return builder },
		})
		return builder
	}
	return { state, client: { from, rpc: async (name: string, args: Record<string, unknown>) => state.rpc(name, args), storage: { from: () => state.storage } } }
})
const auth = vi.hoisted(() => ({ user: vi.fn(), pro: false }))
vi.mock('./auth', () => ({ accountDb: () => db.client, authConfigured: () => true, currentUser: auth.user }))
vi.mock('./billing', () => ({ billingConfigured: () => true, readSubscription: async () => null, subscriptionActive: () => auth.pro }))

import { GET as listBoards, POST as createBoard } from '@/app/api/boards/route'
import { PUT as saveBoard, DELETE as deleteBoard } from '@/app/api/boards/[id]/route'
import { POST as reserveUpload } from '@/app/api/files/route'
import { GET as openFile, POST as commitUpload } from '@/app/api/files/[key]/route'

const BOARD = '11111111-1111-4111-8111-111111111111'
const request = (path: string, method = 'GET', body?: unknown, origin = 'https://loci.example') =>
	new Request(`https://loci.example/api/${path}`, { method, headers: { origin, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const params = <T,>(value: T) => ({ params: Promise.resolve(value) })
const eqUser = (ops: Op[]) => ops.some(([op, [col, val]]) => op === 'eq' && col === 'user_id' && val === 'owner')
const snapshot = { snapshot: { store: {}, schema: {} }, conversation: [], baseVersion: 2 }

beforeEach(() => {
	vi.clearAllMocks()
	db.state.queries = []
	db.state.tables = {}
	db.state.rpc = (name) => ({ data: name === 'loci_storage_used' ? 0 : null, error: null })
	auth.pro = false
	auth.user.mockResolvedValue({ id: 'owner' })
})

describe('account boards', () => {
	it('requires a signed-in user and a same-origin request', async () => {
		expect((await createBoard(request('boards', 'POST', { name: 'x' }, 'https://attacker.example'))).status).toBe(403)
		auth.user.mockResolvedValue(null)
		expect((await listBoards(request('boards'))).status).toBe(401)
		expect((await saveBoard(request(`boards/${BOARD}`, 'PUT', snapshot), params({ id: BOARD }))).status).toBe(401)
		expect(db.state.queries).toHaveLength(0)
	})

	it('only ever reads and writes the signed-in user\'s rows', async () => {
		db.state.tables.loci_boards = () => ({ data: { version: 2, bytes: 10 } })
		db.state.rpc = (name) => ({ data: name === 'loci_save_board' ? 3 : 0, error: null })
		await listBoards(request('boards'))
		await saveBoard(request(`boards/${BOARD}`, 'PUT', snapshot), params({ id: BOARD }))
		await deleteBoard(request(`boards/${BOARD}`, 'DELETE'), params({ id: BOARD }))
		const userTables = db.state.queries.filter((q) => q.table.startsWith('loci_'))
		expect(userTables.length).toBeGreaterThan(3)
		for (const query of userTables) expect(eqUser(query.ops)).toBe(true)
	})

	it('keeps free accounts to their board allowance', async () => {
		db.state.tables.loci_boards = (ops) => (ops.some(([op]) => op === 'insert') ? { data: { id: BOARD } } : { count: 3 })
		const refused = await createBoard(request('boards', 'POST', { name: 'Fourth' }))
		expect(refused.status).toBe(403)
		expect(await refused.json()).toMatchObject({ limitReached: 'boards' })
		auth.pro = true
		expect((await createBoard(request('boards', 'POST', { name: 'Fourth' }))).status).toBe(201)
	})

	it('refuses a save from a stale copy instead of overwriting newer work', async () => {
		db.state.tables.loci_boards = () => ({ data: { version: 5, bytes: 10 } })
		const res = await saveBoard(request(`boards/${BOARD}`, 'PUT', snapshot), params({ id: BOARD }))
		expect(res.status).toBe(409)
		expect(await res.json()).toMatchObject({ version: 5 })
	})
})

describe('account files', () => {
	const upload = { key: 'material-1', boardId: BOARD, bytes: 1000, contentType: 'application/pdf' }

	it('refuses uploads past the plan\'s storage and never trusts a client path', async () => {
		db.state.tables.loci_boards = () => ({ data: { id: BOARD } })
		db.state.tables.loci_files = (ops) => (ops.some(([op, [opt]]) => op === 'select' && (opt as string) === 'key') ? { data: [], count: 0 } : { data: null })
		db.state.rpc = () => ({ data: 25 * 1024 * 1024, error: null })
		const full = await reserveUpload(request('files', 'POST', upload))
		expect(full.status).toBe(403)
		db.state.rpc = () => ({ data: 0, error: null })
		db.state.storage.createSignedUploadUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.example/upload' }, error: null })
		expect((await reserveUpload(request('files', 'POST', { ...upload, key: '../other-user/file' }))).status).toBe(400)
		expect((await reserveUpload(request('files', 'POST', upload))).status).toBe(200)
		expect(db.state.storage.createSignedUploadUrl).toHaveBeenCalledWith('owner/material-1', { upsert: true })
	})

	it('removes an upload larger than the room it reserved', async () => {
		db.state.tables.loci_files = () => ({ data: { bytes: 1000 } })
		db.state.storage.info.mockResolvedValue({ data: { size: 50_000_000 }, error: null })
		db.state.storage.remove.mockResolvedValue({ data: [], error: null })
		expect((await commitUpload(request('files/material-1', 'POST', {}), params({ key: 'material-1' }))).status).toBe(400)
		expect(db.state.storage.remove).toHaveBeenCalledWith(['owner/material-1'])
	})

	it('serves only the owner\'s committed files', async () => {
		db.state.tables.loci_files = () => ({ data: null })
		expect((await openFile(request('files/material-1'), params({ key: 'material-1' }))).status).toBe(404)
		db.state.tables.loci_files = () => ({ data: { committed: true } })
		db.state.storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.example/signed' }, error: null })
		const res = await openFile(request('files/material-1'), params({ key: 'material-1' }))
		expect(res.status).toBe(302)
		expect(db.state.storage.createSignedUrl).toHaveBeenCalledWith('owner/material-1', 3600)
		for (const query of db.state.queries) expect(eqUser(query.ops)).toBe(true)
	})
})
