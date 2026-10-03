/** Upload or delete a demo material file in public/demo/ (local admin only). */
import { adminRefusal, readPack, removeDemoFile, safeName, writeDemoFile } from '@/lib/server/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 40 * 1024 * 1024

export async function POST(req: Request) {
	const refused = adminRefusal(req)
	if (refused) return refused
	const name = safeName(new URL(req.url).searchParams.get('name') ?? '')
	if (!name) return Response.json({ error: 'Use a pdf, png, jpg or webp file.' }, { status: 400 })
	const body = new Uint8Array(await req.arrayBuffer())
	if (!body.byteLength) return Response.json({ error: 'Empty file.' }, { status: 400 })
	if (body.byteLength > MAX_BYTES) return Response.json({ error: 'File too large (40 MB max).' }, { status: 413 })
	await writeDemoFile(name, body)
	return Response.json({ ok: true, file: name })
}

export async function DELETE(req: Request) {
	const refused = adminRefusal(req)
	if (refused) return refused
	const name = safeName(new URL(req.url).searchParams.get('name') ?? '')
	if (!name) return Response.json({ error: 'Unknown file.' }, { status: 400 })
	const pack = await readPack().catch(() => null)
	if (pack?.materials.some((m) => m.file === name)) return Response.json({ error: 'Remove it from the pack first.' }, { status: 409 })
	await removeDemoFile(name)
	return Response.json({ ok: true })
}
