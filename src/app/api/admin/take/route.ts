/** Keep a recorded answer as the take for one branch of a step (local admin only). */
import { z } from 'zod'
import { TakeSchema } from '@/lib/demo/pack'
import { adminRefusal, readPack, writeDemoFile, writePack } from '@/lib/server/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({ step: z.string(), branch: z.string(), take: TakeSchema })

export async function POST(req: Request) {
	const refused = adminRefusal(req)
	if (refused) return refused
	const parsed = Body.safeParse(await req.json().catch(() => null))
	if (!parsed.success) return Response.json({ error: 'Invalid take.' }, { status: 400 })
	const { step: stepId, branch: branchId, take } = parsed.data
	const pack = await readPack()
	const step = pack.steps.find((s) => s.id === stepId)
	const branch = step?.branches.find((b) => b.id === branchId)
	if (!step || !branch) return Response.json({ error: 'No such step or branch.' }, { status: 404 })
	if (!take.events.some((e) => e.type === 'say' || e.type === 'action')) return Response.json({ error: 'That answer is empty.' }, { status: 400 })
	const path = `takes/${stepId}--${branchId}.json`
	await writeDemoFile(path, JSON.stringify(take, null, 1) + '\n')
	branch.take = path
	branch.sample = take.question.slice(0, 400)
	await writePack(pack)
	return Response.json({ ok: true, take: path, pack })
}

export async function DELETE(req: Request) {
	const refused = adminRefusal(req)
	if (refused) return refused
	const url = new URL(req.url)
	const pack = await readPack()
	const branch = pack.steps.find((s) => s.id === url.searchParams.get('step'))?.branches.find((b) => b.id === url.searchParams.get('branch'))
	if (!branch) return Response.json({ error: 'No such step or branch.' }, { status: 404 })
	delete branch.take
	await writePack(pack)
	return Response.json({ ok: true, pack })
}
