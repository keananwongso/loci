import { z } from 'zod'
import { accountDb } from '@/lib/server/auth'
import { BUCKET, FILE_TYPES, accountUser, filePath, noStore, planFor, storageUsed } from '@/lib/server/boards'
import { readLimitedJson } from '@/lib/server/request'

const MAX_PENDING = 8
const Upload = z.object({
	key: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/),
	boardId: z.uuid().nullish(),
	bytes: z.number().int().positive().max(50 * 1024 * 1024),
	contentType: z.enum(FILE_TYPES),
})

/**
 * Reserve room for an upload and hand back a one-time signed URL, so the browser sends the file
 * straight to storage (past Vercel's 4.5 MB body limit). The commit step records its real size.
 */
export async function POST(req: Request) {
	const user = await accountUser(req, { mutating: true })
	if (user instanceof Response) return user
	const body = await readLimitedJson(req, 2048)
	if (body instanceof Response) return body
	const parsed = Upload.safeParse(body.value)
	if (!parsed.success) return Response.json({ error: 'Loci saves PDFs, images, audio and replays up to 50 MB.' }, { status: 400 })
	const { key, boardId, bytes, contentType } = parsed.data
	try {
		const db = accountDb()
		if (boardId) {
			const board = await db.from('loci_boards').select('id').eq('id', boardId).eq('user_id', user.id).maybeSingle()
			if (board.error) throw board.error
			if (!board.data) return Response.json({ error: 'That board is not in your account.' }, { status: 404 })
		}
		// A signed upload can't cap its size, so unconfirmed uploads are few and short-lived.
		const stale = await db.from('loci_files').select('key').eq('user_id', user.id).eq('committed', false).lt('created_at', new Date(Date.now() - 3600_000).toISOString())
		if (stale.error) throw stale.error
		if (stale.data.length) {
			const keys = stale.data.map((f) => f.key)
			const removed = await db.storage.from(BUCKET).remove(keys.map((k) => filePath(user.id, k)))
			if (removed.error) throw removed.error
			const rows = await db.from('loci_files').delete().eq('user_id', user.id).in('key', keys)
			if (rows.error) throw rows.error
		}
		const pending = await db.from('loci_files').select('key', { count: 'exact', head: true }).eq('user_id', user.id).eq('committed', false).neq('key', key)
		if (pending.error) throw pending.error
		if ((pending.count ?? 0) >= MAX_PENDING) return Response.json({ error: 'Too many uploads at once. Wait for the others to finish.' }, { status: 429 })
		const existing = await db.from('loci_files').select('bytes').eq('user_id', user.id).eq('key', key).maybeSingle()
		if (existing.error) throw existing.error
		const [plan, used] = await Promise.all([planFor(user), storageUsed(user.id)])
		if (used - (existing.data?.bytes ?? 0) + bytes > plan.bytes)
			return Response.json({ error: plan.pro ? 'Your storage is full.' : 'Free storage is full. Upgrade to Loci Pro for more room.', limitReached: 'storage' }, { status: 403 })
		const row = await db.from('loci_files').upsert({ user_id: user.id, key, board_id: boardId ?? null, bytes, content_type: contentType, committed: false, created_at: new Date().toISOString() }, { onConflict: 'user_id,key' })
		if (row.error) throw row.error
		const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(filePath(user.id, key), { upsert: true })
		if (error) throw error
		return Response.json({ uploadUrl: data.signedUrl }, { headers: noStore })
	} catch (err) {
		console.error('[loci] upload reservation failed:', err instanceof Error ? err.message : err)
		return Response.json({ error: 'Could not start the upload.' }, { status: 503 })
	}
}
