import { readLimitedJson, refuseCrossOrigin } from '@/lib/server/request'
/**
 * Local text-to-speech endpoint for voice mode. Only the tutor's spoken sentences are sent to
 * Fish Audio; nothing is stored. Without FISH_API_KEY the browser's built-in voice is used.
 */
import { z } from 'zod'
import { FishError, MAX_SPEECH_CHARS, fishConfigFromEnv, fishSpeech } from '@/lib/voice/fish'
import { guardUsage } from '@/lib/server/usage'
import { countryOf, recordStats } from '@/lib/server/stats'
import { userVoiceFromHeaders, userVoiceSpeech, safeVoiceError } from '@/lib/voice/user-voice'
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
 let userVoice
 try { userVoice = userVoiceFromHeaders(req.headers) } catch { return Response.json({ error: 'Invalid voice settings. Check the provider, key, voice ID and model.' }, { status: 400 }) }
 const config = fishConfigFromEnv()
 if (!userVoice && !config.apiKey) return Response.json({ error: 'Voice is not configured.' }, { status: 503 })
 let cookie: string | undefined
 if (!userVoice) {
  const usage = await guardUsage(req, 'speech', parsed.data.text.length)
  if (usage.refused) return usage.refused
  cookie = usage.cookie
  const device = deviceFor(req)
  await recordStats({ speechChars: parsed.data.text.length }, device.setCookie ? undefined : { id: device.id, country: countryOf(req) })
 }
	try {
		const audio = userVoice ? await userVoiceSpeech(parsed.data.text, userVoice, req.signal) : await fishSpeech(parsed.data.text, config, req.signal)
		const timed = audio.pipeThrough(timeStream(parsed.data.text.length, userVoice ? 'user voice provider' : config.model, start))
		const res = new Response(timed, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } })
		if (cookie) res.headers.append('Set-Cookie', cookie)
		return res
	} catch (err) {
		const status = err instanceof FishError ? err.status : 502
		if (!req.signal.aborted) console.error('[loci] speech failed:', { status })
		// Upstream error text may contain credentials; the browser falls back to its own voice.
		return Response.json({ error: userVoice ? safeVoiceError(status) : 'Speech failed.' }, { status: status >= 400 && status < 600 ? status : 502 })
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
