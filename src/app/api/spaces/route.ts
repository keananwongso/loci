import { z } from 'zod'
import { accountDb } from '@/lib/server/auth'
import { accountUser, noStore } from '@/lib/server/boards'
import { readLimitedJson } from '@/lib/server/request'
export async function POST(req: Request) {
 const user = await accountUser(req, { mutating: true }); if (user instanceof Response) return user
 const body = await readLimitedJson(req, 2048); if (body instanceof Response) return body
 const parsed = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(body.value)
 if (!parsed.success) return Response.json({ error: 'Give the space a name of up to 80 characters.' }, { status: 400 })
 try {
  const db = accountDb()
  const { count, error } = await db.from('loci_spaces').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
  if (error) throw error
  if ((count ?? 0) >= 100) return Response.json({ error: 'You can create up to 100 spaces.' }, { status: 403 })
  const { data, error: insertError } = await db.from('loci_spaces').insert({ user_id: user.id, name: parsed.data.name }).select('id,name,updated_at').single()
  if (insertError) throw insertError
  return Response.json({ space: data }, { status: 201, headers: noStore })
 } catch { return Response.json({ error: 'Could not create the space.' }, { status: 503 }) }
}
