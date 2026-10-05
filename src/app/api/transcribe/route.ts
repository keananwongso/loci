import { readLimitedBody, refuseCrossOrigin } from '@/lib/server/request'
/**
 * Speech to text for hold-to-talk. The recording of the student's question is sent to Fish Audio
 * and the transcript returned; nothing is stored. Without FISH_API_KEY this returns 503 and the
 * browser's own speech recognition is used instead.
 */
import { FishError, MAX_RECORDING_BYTES, fishConfigFromEnv, fishTranscribe } from '@/lib/voice/fish'
import { guardUsage } from '@/lib/server/usage'
import { countryOf, recordStats } from '@/lib/server/stats'
import { deviceFor } from '@/lib/server/device'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
	const refusedOrigin = refuseCrossOrigin(req)
	if (refusedOrigin) return refusedOrigin
	const config = fishConfigFromEnv()
	if (!config.apiKey) return Response.json({ error: 'FISH_API_KEY is not set.' }, { status: 503 })
	const body = await readLimitedBody(req, MAX_RECORDING_BYTES)
	if (body instanceof Response) return body
	const audio = new Blob([body as BlobPart], { type: req.headers.get('content-type') ?? '' })
	if (!audio || audio.size === 0) return Response.json({ error: 'No audio.' }, { status: 400 })
	if (audio.size > MAX_RECORDING_BYTES) return Response.json({ error: 'Recording too long.' }, { status: 413 })
	const { refused, cookie } = await guardUsage(req, 'transcribe', 1)
	if (refused) return refused
	const device = deviceFor(req)
	// Only a returning browser (it has the cookie) is attributed; a new random id would be a phantom visitor.
	await recordStats({ transcriptions: 1 }, device.setCookie ? undefined : { id: device.id, country: countryOf(req) })
	const start = performance.now()
	try {
		const text = await fishTranscribe(audio, config, req.signal)
		const took = ((performance.now() - start) / 1000).toFixed(2)
		console.info(`[loci] transcribed ${Math.round(audio.size / 1024)} KB (${audio.type || 'unknown type'}) in ${took}s: ${text ? 'words detected' : 'no words'}`)
		const res = Response.json({ text })
		if (cookie) res.headers.append('Set-Cookie', cookie)
		return res
	} catch (err) {
		const status = err instanceof FishError ? err.status : 502
		const message = err instanceof Error ? err.message : 'Transcription failed.'
		if (!req.signal.aborted) console.error('[loci] transcription failed:', message)
		// The upstream detail stays in the server log; the browser just falls back to its own voice.
		return Response.json({ error: 'Transcription failed.' }, { status: status >= 400 && status < 600 ? status : 502 })
	}
}
