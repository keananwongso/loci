/**
 * Speech to text for hold-to-talk. The recording of the student's question is sent to Fish Audio
 * and the transcript returned; nothing is stored. Without FISH_API_KEY this returns 503 and the
 * browser's own speech recognition is used instead.
 */
import { FishError, MAX_RECORDING_BYTES, fishConfigFromEnv, fishTranscribe } from '@/lib/voice/fish'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
	const config = fishConfigFromEnv()
	if (!config.apiKey) return Response.json({ error: 'FISH_API_KEY is not set.' }, { status: 503 })
	const audio = await req.blob().catch(() => null)
	if (!audio || audio.size === 0) return Response.json({ error: 'No audio.' }, { status: 400 })
	if (audio.size > MAX_RECORDING_BYTES) return Response.json({ error: 'Recording too long.' }, { status: 413 })
	try {
		const text = await fishTranscribe(audio, config, req.signal)
		console.info(`[loci] transcribed ${Math.round(audio.size / 1024)} KB (${audio.type || 'unknown type'}): ${text ? `"${text.slice(0, 80)}"` : '(no words)'}`)
		return Response.json({ text })
	} catch (err) {
		const status = err instanceof FishError ? err.status : 502
		const message = err instanceof Error ? err.message : 'Transcription failed.'
		if (!req.signal.aborted) console.error('[loci] transcription failed:', message)
		return Response.json({ error: message }, { status: status >= 400 && status < 600 ? status : 502 })
	}
}
