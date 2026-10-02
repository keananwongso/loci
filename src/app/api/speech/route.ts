/**
 * Local text-to-speech endpoint for voice mode. Only the tutor's spoken sentences are sent to
 * Fish Audio; nothing is stored. Without FISH_API_KEY the browser's built-in voice is used.
 */
import { z } from 'zod'
import { FishError, MAX_SPEECH_CHARS, fishConfigFromEnv, fishSpeech } from '@/lib/voice/fish'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
	const config = fishConfigFromEnv()
	return Response.json({ provider: config.apiKey ? 'fish' : 'browser', model: config.apiKey ? config.model : undefined })
}

const Body = z.object({ text: z.string().min(1).max(MAX_SPEECH_CHARS) })

export async function POST(req: Request) {
	const parsed = Body.safeParse(await req.json().catch(() => null))
	if (!parsed.success) return Response.json({ error: 'Invalid request.' }, { status: 400 })
	try {
		const audio = await fishSpeech(parsed.data.text, fishConfigFromEnv(), req.signal)
		return new Response(audio, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } })
	} catch (err) {
		const status = err instanceof FishError ? err.status : 502
		const message = err instanceof Error ? err.message : 'Speech failed.'
		if (!req.signal.aborted) console.error('[loci] speech failed:', message)
		return Response.json({ error: message }, { status: status >= 400 && status < 600 ? status : 502 })
	}
}
