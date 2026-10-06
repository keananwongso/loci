import { accountDb } from '@/lib/server/auth'
import { BUCKET, accountUser, filePath, noStore } from '@/lib/server/boards'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ key: string }> }
const KEY = /^[A-Za-z0-9_-]{1,120}$/
const notFound = () => Response.json({ error: 'File not found.' }, { status: 404 })

/** Open a file: a short-lived signed URL, so large files never pass through this function. */
export async function GET(req: Request, { params }: Params) {
	const user = await accountUser(req, { mutating: false })
	if (user instanceof Response) return user
	const { key } = await params
	if (!KEY.test(key)) return notFound()
	try {
		const db = accountDb()
		const row = await db.from('loci_files').select('committed').eq('user_id', user.id).eq('key', key).maybeSingle()
		if (row.error) throw row.error
		if (!row.data?.committed) return notFound()
		const { data, error } = await db.storage.from(BUCKET).createSignedUrl(filePath(user.id, key), 3600)
		if (error) throw error
		return new Response(null, { status: 302, headers: { Location: data.signedUrl, 'Cache-Control': 'private, max-age=3000' } })
	} catch (err) {
		console.error('[loci] file open failed:', err instanceof Error ? err.message : err)
		return Response.json({ error: 'Could not open the file.' }, { status: 503 })
	}
}

/** Confirm an upload landed and count its real size, not the size the browser announced. */
export async function POST(req: Request, { params }: Params) {
	const user = await accountUser(req, { mutating: true })
	if (user instanceof Response) return user
	const { key } = await params
	if (!KEY.test(key)) return notFound()
	try {
		const db = accountDb()
		const row = await db.from('loci_files').select('bytes').eq('user_id', user.id).eq('key', key).maybeSingle()
		if (row.error) throw row.error
		if (!row.data) return notFound()
		const info = await db.storage.from(BUCKET).info(filePath(user.id, key))
		if (info.error || info.data.size == null) return Response.json({ error: 'The upload did not finish. Try again.' }, { status: 409 })
		// An upload larger than the room reserved for it is removed rather than counted.
		if (info.data.size > row.data.bytes) {
			await db.storage.from(BUCKET).remove([filePath(user.id, key)])
			await db.from('loci_files').delete().eq('user_id', user.id).eq('key', key)
			return Response.json({ error: 'The upload was larger than announced.' }, { status: 400 })
		}
		const { error } = await db.from('loci_files').update({ bytes: info.data.size, committed: true }).eq('user_id', user.id).eq('key', key)
		if (error) throw error
		return Response.json({ committed: true }, { headers: noStore })
	} catch (err) {
		console.error('[loci] upload commit failed:', err instanceof Error ? err.message : err)
		return Response.json({ error: 'Could not save the upload.' }, { status: 503 })
	}
}

export async function DELETE(req: Request, { params }: Params) {
	const user = await accountUser(req, { mutating: true })
	if (user instanceof Response) return user
	const { key } = await params
	if (!KEY.test(key)) return notFound()
	try {
		const db = accountDb()
		const removed = await db.storage.from(BUCKET).remove([filePath(user.id, key)])
		if (removed.error) throw removed.error
		const { error } = await db.from('loci_files').delete().eq('user_id', user.id).eq('key', key)
		if (error) throw error
		return Response.json({ deleted: true }, { headers: noStore })
	} catch (err) {
		console.error('[loci] file delete failed:', err instanceof Error ? err.message : err)
		return Response.json({ error: 'Could not delete the file.' }, { status: 503 })
	}
}
