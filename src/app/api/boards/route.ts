import { z } from 'zod'
import { accountDb } from '@/lib/server/auth'
import { accountUser, noStore, planFor, storageUsed } from '@/lib/server/boards'
import { readLimitedJson } from '@/lib/server/request'

export const dynamic = 'force-dynamic'

/** The account's boards (without their contents), spaces and how much of the plan they use. */
export async function GET(req: Request) {
	const user = await accountUser(req, { mutating: false })
	if (user instanceof Response) return user
	try {
		const db = accountDb()
		const [boards, spaces, plan, used] = await Promise.all([
			db.from('loci_boards').select('id, name, space_id, version, updated_at').eq('user_id', user.id).order('updated_at', { ascending: false }),
			db.from('loci_spaces').select('id, name, updated_at').eq('user_id', user.id).order('name'),
			planFor(user),
			storageUsed(user.id),
		])
		if (boards.error) throw boards.error
		if (spaces.error) throw spaces.error
		return Response.json({ boards: boards.data, spaces: spaces.data, plan: { ...plan, used } }, { headers: noStore })
	} catch (err) {
		console.error('[loci] board list failed:', err instanceof Error ? err.message : err)
		return Response.json({ error: 'Could not load your boards.' }, { status: 503 })
	}
}

const Create = z.object({ name: z.string().trim().min(1).max(80), spaceId: z.uuid().nullish() })
export async function POST(req: Request) {
	const user = await accountUser(req, { mutating: true })
	if (user instanceof Response) return user
	const body = await readLimitedJson(req, 2048)
	if (body instanceof Response) return body
	const parsed = Create.safeParse(body.value)
	if (!parsed.success) return Response.json({ error: 'Give the board a name of up to 80 characters.' }, { status: 400 })
	try {
		const db = accountDb()
		const plan = await planFor(user)
		const { count, error } = await db.from('loci_boards').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
		if (error) throw error
		if ((count ?? 0) >= plan.boards)
			return Response.json({ error: plan.pro ? 'You have reached the board limit.' : `Free accounts can save ${plan.boards} boards. Upgrade to Loci Pro for more.`, limitReached: 'boards' }, { status: 403 })
		if (parsed.data.spaceId) {
			const space = await db.from('loci_spaces').select('id').eq('id', parsed.data.spaceId).eq('user_id', user.id).maybeSingle()
			if (space.error) throw space.error
			if (!space.data) return Response.json({ error: 'That space no longer exists.' }, { status: 404 })
		}
		const { data, error: insertError } = await db.from('loci_boards')
			.insert({ user_id: user.id, name: parsed.data.name, space_id: parsed.data.spaceId ?? null })
			.select('id, name, space_id, version, updated_at').single()
		if (insertError) throw insertError
		return Response.json({ board: data }, { status: 201, headers: noStore })
	} catch (err) {
		console.error('[loci] board create failed:', err instanceof Error ? err.message : err)
		return Response.json({ error: 'Could not create the board.' }, { status: 503 })
	}
}
