/**
 * Pre-render every line the demo can speak with Fish Audio into public/demo/voice/, and drop clips
 * nothing uses any more (local admin only). Visitors then hear the demo without any Fish calls.
 */
import { ACK_PHRASES } from '@/lib/voice/ack-phrases'
import { fishConfigFromEnv, fishSpeech } from '@/lib/voice/fish'
import { toSpoken } from '@/lib/voice/spoken'
import { adminRefusal, clipName, demoLines, listFiles, readPack, readVoiceMap, removeDemoFile, writeDemoFile, writeVoiceMap } from '@/lib/server/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function collect(stream: ReadableStream<Uint8Array>) {
	return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function POST(req: Request) {
	const refused = adminRefusal(req)
	if (refused) return refused
	// No one is waiting on these: render at full quality.
	const config = { ...fishConfigFromEnv(), latency: 'normal' as const }
	if (!config.apiKey) return Response.json({ error: 'Set FISH_API_KEY in .env.local to render the voice.' }, { status: 503 })
	// Changing the voice or how it is read re-renders every clip.
	const voice = `${config.model}:${config.voiceId ?? 'default'}:${config.speed}:${config.temperature}`
	const lines = [...new Set([...(await demoLines(await readPack())), ...Object.values(ACK_PHRASES).flat()])]
	const old = await readVoiceMap()
	const map: Record<string, string> = {}
	const failed: string[] = []
	let rendered = 0
	for (const line of lines) {
		const file = clipName(line, voice)
		if (old[line] === file) {
			map[line] = file
			continue
		}
		const spoken = toSpoken(line)
		if (!spoken) continue
		try {
			await writeDemoFile(file, await collect(await fishSpeech(spoken, config, req.signal)))
			map[line] = file
			rendered++
		} catch (err) {
			failed.push(`${line.slice(0, 60)}: ${err instanceof Error ? err.message : err}`)
			if (old[line]) map[line] = old[line]
		}
	}
	await writeVoiceMap(map)
	const used = new Set(Object.values(map))
	const stale = (await listFiles('voice')).filter((f) => !used.has(f))
	await Promise.all(stale.map(removeDemoFile))
	return Response.json({ ok: failed.length === 0, rendered, kept: lines.length - rendered - failed.length, removed: stale.length, failed })
}
