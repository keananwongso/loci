import { readLimitedJson, refuseCrossOrigin } from '@/lib/server/request'
/**
 * Local text-to-speech endpoint for voice mode. Only the tutor's spoken sentences are sent to
 * Fish Audio; nothing is stored. Without FISH_API_KEY the browser's built-in voice is used.
 */
import { z } from 'zod'
import { FishError, MAX_SPEECH_CHARS, fishConfigFromEnv, fishSpeech } from '@/lib/voice/fish'
import { guardUsage } from '@/lib/server/usage'
import { countryOf, recordStats } from '@/lib/server/stats'
import { deviceFor } from '@/lib/server/device'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
	const config = fishConfigFromEnv()
	return Response.json({ provider: config.apiKey ? 'fish' : 'browser', model: config.apiKey ? config.model : undefined })
}

const Body = z.object({ text: z.string().min(1).max(MAX_SPEECH_CHARS) })

export async function POST(req: Request) {
	const refusedOrigin = refuseCrossOrigin(req)
	if (refusedOrigin) return refusedOrigin
	const body = await readLimitedJson(req, 16 * 1024)
	if (body instanceof Response) return body
	const parsed = Body.safeParse(body.value)
	if (!parsed.success) return Response.json({ error: 'Invalid request.' }, { status: 400 })
	const start = performance.now()
	const config = fishConfigFromEnv()
	if (!config.apiKey) return Response.json({ error: 'FISH_API_KEY is not set.' }, { status: 503 })
	const { refused, cookie } = await guardUsage(req, 'speech', parsed.data.text.length)
	if (refused) return refused
	const device = deviceFor(req)
	// Only a returning browser (it has the cookie) is attributed; a new random id would be a phantom visitor.
	await recordStats({ speechChars: parsed.data.text.length }, device.setCookie ? undefined : { id: device.id, country: countryOf(req) })
	try {
		const audio = await fishSpeech(parsed.data.text, config, req.signal)
		const timed = audio.pipeThrough(timeStream(parsed.data.text.length, config.model, start))
		const res = new Response(timed, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } })
		if (cookie) res.headers.append('Set-Cookie', cookie)
		return res
	} catch (err) {
		const status = err instanceof FishError ? err.status : 502
		const message = err instanceof Error ? err.message : 'Speech failed.'
		if (!req.signal.aborted) console.error('[loci] speech failed:', message)
		// The upstream detail stays in the server log; the browser just falls back to its own voice.
		return Response.json({ error: 'Speech failed.' }, { status: status >= 400 && status < 600 ? status : 502 })
	}
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`

/** Passes the audio through untouched, logging when its first bytes and its end arrived. */
function timeStream(chars: number, model: string, start: number) {
	let first = 0
	let bytes = 0
	return new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			if (!first) first = performance.now()
			bytes += chunk.byteLength
			controller.enqueue(chunk)
		},
		flush() {
			const now = performance.now()
			console.info(
				`[loci] speech ${model}, ${chars} chars: first audio ${seconds((first || now) - start)} · done ${seconds(now - start)} · ${Math.round(bytes / 1024)} KB`
			)
		},
	})
}
