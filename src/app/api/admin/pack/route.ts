/** Read and save the demo pack (local admin only). */
import { DemoPackSchema } from '@/lib/demo/pack'
import { fishConfigFromEnv } from '@/lib/voice/fish'
import { ACK_PHRASES } from '@/lib/voice/ack-phrases'
import { adminRefusal, demoLines, listFiles, readPack, readPackRaw, readVoiceMap, writePack } from '@/lib/server/admin'
import { getProvider } from '@/lib/providers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
	const refused = adminRefusal(req)
	if (refused) return refused
	const raw = await readPackRaw().catch(() => null)
	const parsed = DemoPackSchema.safeParse(raw)
	const [files, takes, voice] = await Promise.all([listFiles(), listFiles('takes'), readVoiceMap()])
	const lines = parsed.success ? [...(await demoLines(parsed.data)), ...Object.values(ACK_PHRASES).flat()] : []
	let model = ''
	try {
		const p = getProvider()
		model = `${p.name}/${p.model}`
	} catch {}
	return Response.json({
		pack: parsed.success ? parsed.data : raw,
		problems: parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
		files,
		takes,
		voice: { lines: lines.length, missing: lines.filter((l) => !voice[l]).length, fish: Boolean(fishConfigFromEnv().apiKey) },
		model,
	})
}

export async function PUT(req: Request) {
	const refused = adminRefusal(req)
	if (refused) return refused
	const parsed = DemoPackSchema.safeParse(await req.json().catch(() => null))
	if (!parsed.success) {
		return Response.json({ error: 'The pack is not valid.', problems: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, { status: 400 })
	}
	const files = new Set(await listFiles())
	const missing = parsed.data.materials.filter((m) => !files.has(m.file)).map((m) => m.file)
	if (missing.length) return Response.json({ error: `Missing files: ${missing.join(', ')}` }, { status: 400 })
	await writePack(parsed.data)
	return Response.json({ ok: true, pack: await readPack() })
}
