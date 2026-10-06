import { z } from 'zod'
import { accountDb } from '@/lib/server/auth'
import { BUCKET, accountUser, filePath, noStore, planFor, storageUsed } from '@/lib/server/boards'
import { readLimitedBody, readLimitedJson } from '@/lib/server/request'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ id: string }> }
const Id = z.uuid()
// Vercel caps request bodies at 4.5 MB; files go to storage, so boards rarely come close.
const MAX_SAVE_BYTES = 4 * 1024 * 1024
const notFound = () => Response.json({ error: 'That board is not in your account.' }, { status: 404 })

export async function GET(req: Request, { params }: Params) {
	const user = await accountUser(req, { mutating: false })
	if (user instanceof Response) return user
	const id = Id.safeParse((await params).id)
	if (!id.success) return notFound()
	try {
		const { data, error } = await accountDb().from('loci_boards')
			.select('id, name, space_id, version, updated_at, snapshot, conversation').eq('id', id.data).eq('user_id', user.id).maybeSingle()
		if (error) throw error
		return data ? Response.json({ board: data }, { headers: noStore }) : notFound()
	} catch (err) {
		console.error('[loci] board load failed:', err instanceof Error ? err.message : err)
		return Response.json({ error: 'Could not open the board.' }, { status: 503 })
	}
}

const Save = z.object({
	baseVersion: z.number().int().min(0),
	snapshot: z.object({ store: z.record(z.string(), z.unknown()), schema: z.unknown() }).passthrough(),
	conversation: z.array(z.unknown()).max(500),
})
/** Save the board's contents, but only on top of the version this copy was last in step with. */
export async function PUT(req: Request, { params }: Params) {
	const user = await accountUser(req, { mutating: true })
	if (user instanceof Response) return user
	const id = Id.safeParse((await params).id)
	if (!id.success) return notFound()
	const raw = await readLimitedBody(req, MAX_SAVE_BYTES)
	if (raw instanceof Response) return Response.json({ error: 'This board is too large to save. Split it into another board.' }, { status: 413 })
	let parsed
	try { parsed = Save.safeParse(JSON.parse(new TextDecoder().decode(raw))) } catch { return Response.json({ error: 'Invalid board.' }, { status: 400 }) }
	if (!parsed.success) return Response.json({ error: 'Invalid board.' }, { status: 400 })
	try {
		const db = accountDb()
		const current = await db.from('loci_boards').select('version, bytes').eq('id', id.data).eq('user_id', user.id).maybeSingle()
		if (current.error) throw current.error
		if (!current.data) return notFound()
		const [plan, used] = await Promise.all([planFor(user), storageUsed(user.id)])
		if (raw.byteLength > current.data.bytes && used - current.data.bytes + raw.byteLength > plan.bytes)
			return Response.json({ error: plan.pro ? 'Your storage is full.' : 'Free storage is full. Upgrade to Loci Pro for more room.', limitReached: 'storage' }, { status: 403 })
		const { data: version, error } = await db.rpc('loci_save_board', {
			p_user: user.id, p_board: id.data, p_base: parsed.data.baseVersion,
			p_snapshot: parsed.data.snapshot, p_conversation: parsed.data.conversation, p_bytes: raw.byteLength,
		})
		if (error) throw error
		if (version == null) return Response.json({ error: 'This board changed on another device.', version: current.data.version }, { status: 409, headers: noStore })
		return Response.json({ version }, { headers: noStore })
	} catch (err) {
		console.error('[loci] board save failed:', err instanceof Error ? err.message : err)
		return Response.json({ error: 'Could not save the board.' }, { status: 503 })
	}
}

const Patch = z.object({ name: z.string().trim().min(1).max(80).optional(), spaceId: z.uuid().nullable().optional() })
export async function PATCH(req: Request, { params }: Params) {
	const user = await accountUser(req, { mutating: true })
	if (user instanceof Response) return user
	const id = Id.safeParse((await params).id)
	if (!id.success) return notFound()
	const body = await readLimitedJson(req, 2048)
	if (body instanceof Response) return body
	const parsed = Patch.safeParse(body.value)
	if (!parsed.success || (parsed.data.name === undefined && parsed.data.spaceId === undefined)) return Response.json({ error: 'Nothing to change.' }, { status: 400 })
	try {
		const db = accountDb()
		if (parsed.data.spaceId) {
			const space = await db.from('loci_spaces').select('id').eq('id', parsed.data.spaceId).eq('user_id', user.id).maybeSingle()
			if (space.error) throw space.error
			if (!space.data) return Response.json({ error: 'That space no longer exists.' }, { status: 404 })
		}
		const changes = { ...(parsed.data.name !== undefined && { name: parsed.data.name }), ...(parsed.data.spaceId !== undefined && { space_id: parsed.data.spaceId }) }
		const { data, error } = await db.from('loci_boards').update(changes).eq('id', id.data).eq('user_id', user.id)
			.select('id, name, space_id, version, updated_at').maybeSingle()
		if (error) throw error
		return data ? Response.json({ board: data }, { headers: noStore }) : notFound()
	} catch (err) {
		console.error('[loci] board update failed:', err instanceof Error ? err.message : err)
		return Response.json({ error: 'Could not update the board.' }, { status: 503 })
	}
}

/** Delete the board and the files that belong only to it. */
export async function DELETE(req: Request, { params }: Params) {
	const user = await accountUser(req, { mutating: true })
	if (user instanceof Response) return user
	const id = Id.safeParse((await params).id)
	if (!id.success) return notFound()
	try {
		const db = accountDb()
		const files = await db.from('loci_files').select('key').eq('user_id', user.id).eq('board_id', id.data)
		if (files.error) throw files.error
		const keys = files.data.map((f) => f.key)
		if (keys.length) {
			const removed = await db.storage.from(BUCKET).remove(keys.map((key) => filePath(user.id, key)))
			if (removed.error) throw removed.error
			const rows = await db.from('loci_files').delete().eq('user_id', user.id).in('key', keys)
			if (rows.error) throw rows.error
		}
		const { data, error } = await db.from('loci_boards').delete().eq('id', id.data).eq('user_id', user.id).select('id').maybeSingle()
		if (error) throw error
		return data ? Response.json({ deleted: true }, { headers: noStore }) : notFound()
	} catch (err) {
		console.error('[loci] board delete failed:', err instanceof Error ? err.message : err)
		return Response.json({ error: 'Could not delete the board.' }, { status: 503 })
	}
}
