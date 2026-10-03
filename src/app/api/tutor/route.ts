/**
 * Local tutor endpoint. Runs on the user's own machine (`npm run dev`); it holds the
 * provider API key server-side, forwards only the context for this one question to the
 * configured model, and streams validated canvas actions back as newline-delimited JSON.
 * Nothing is stored here.
 */
import { getToolDefinitions } from '@/lib/actions/tools'
import { getProvider, providerForUserKey } from '@/lib/providers'
import { MockProvider } from '@/lib/providers/mock'
import type { TutorModelProvider } from '@/lib/providers/types'
import { deviceFor, ipHashFor } from '@/lib/server/device'
import { limitConfigFromEnv, readQuota, takeQuestion, type Quota } from '@/lib/server/limits'
import { buildTurnText, SYSTEM_PROMPT } from '@/lib/tutor/prompt'
import { ActionSession } from '@/lib/tutor/session'
import { TutorRequestSchema, type TutorEvent } from '@/lib/tutor/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Long tutoring turns stream for a while; hosts like Vercel cap this per plan.
export const maxDuration = 300

const MAX_BODY_BYTES = 24 * 1024 * 1024

export async function GET(req: Request) {
	const limits = limitConfigFromEnv()
	const device = deviceFor(req)
	let quota: Quota | undefined
	if (limits.enabled) quota = await readQuota(limits, device.id, ipHashFor(req)).catch(() => undefined)
	try {
		const provider = getProvider()
		return withCookie(
			Response.json({
				provider: provider.name,
				model: provider.model,
				configured: provider.isConfigured(),
				setupHint: provider.setupHint,
				hosted: limits.enabled,
				quota,
			}),
			device.setCookie
		)
	} catch (err) {
		return Response.json({ configured: false, setupHint: (err as Error).message, hosted: limits.enabled }, { status: 500 })
	}
}

function withCookie(res: Response, cookie?: string) {
	if (cookie) res.headers.append('Set-Cookie', cookie)
	return res
}

const LIMIT_MESSAGES = {
	device: "You've used today's free questions on this device.",
	ip: "Today's free questions for this network are used up.",
	global: "The free demo has hit today's limit.",
}

/**
 * Which model answers: the free scripted lesson, the visitor's own key (sent in headers for this
 * request only, never stored or logged), or the server's key under the demo limits.
 */
async function chooseProvider(req: Request): Promise<{ provider: TutorModelProvider; quota?: Quota; cookie?: string } | Response> {
	if (req.headers.get('x-loci-demo') === 'scripted') return { provider: new MockProvider() }

	const userKey = req.headers.get('x-loci-key')
	if (userKey) {
		try {
			return {
				provider: providerForUserKey(
					req.headers.get('x-loci-provider') ?? '',
					userKey,
					req.headers.get('x-loci-model')?.slice(0, 120) || undefined
				),
			}
		} catch (err) {
			return Response.json({ error: (err as Error).message }, { status: 400 })
		}
	}

	let provider: TutorModelProvider
	try {
		provider = getProvider()
	} catch (err) {
		return Response.json({ error: (err as Error).message }, { status: 500 })
	}
	const limits = limitConfigFromEnv()
	if (!limits.enabled) return { provider }
	const device = deviceFor(req)
	const decision = await takeQuestion(limits, device.id, ipHashFor(req))
	if (!decision.ok) {
		return withCookie(
			Response.json({ error: LIMIT_MESSAGES[decision.reason], limitReached: decision.reason, quota: decision.quota }, { status: 429 }),
			device.setCookie
		)
	}
	return { provider, quota: decision.quota, cookie: device.setCookie }
}

export async function POST(req: Request) {
	const length = Number(req.headers.get('content-length') ?? 0)
	if (length > MAX_BODY_BYTES) return Response.json({ error: 'Request too large.' }, { status: 413 })

	const parsed = TutorRequestSchema.safeParse(await req.json().catch(() => null))
	if (!parsed.success) {
		const where = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`)
		console.warn(`[loci] rejected a tutor request: ${where.join('; ')}`)
		return Response.json({ error: 'Invalid request.', details: parsed.error.issues.slice(0, 5) }, { status: 400 })
	}
	const request = parsed.data

	const chosen = await chooseProvider(req)
	if (chosen instanceof Response) return chosen
	const { provider, quota, cookie } = chosen
	if (!provider.isConfigured()) {
		return Response.json({ error: `No model configured. ${provider.setupHint}` }, { status: 503 })
	}

	const encoder = new TextEncoder()
	const abort = new AbortController()
	req.signal.addEventListener('abort', () => abort.abort())

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const timing = new TurnTiming()
			const emit = (event: TutorEvent) => {
				if (abort.signal.aborted) return
				timing.saw(event)
				controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
			}
			const session = new ActionSession(request.board, emit)
			try {
				await provider.run(
					{ system: SYSTEM_PROMPT, tools: getToolDefinitions(), request, turnText: buildTurnText(request) },
					session,
					emit,
					abort.signal
				)
			} catch (err) {
				if (!abort.signal.aborted) {
					console.error('[loci] tutor request failed:', err instanceof Error ? err.message : err)
					emit({ type: 'error', message: provider.describeError?.(err) ?? (err instanceof Error ? err.message : String(err)) })
				}
			}
			emit({ type: 'done' })
			controller.close()
			console.info(`[loci] tutor ${provider.name} ${provider.model}: ${timing.summary()}${abort.signal.aborted ? ' (stopped)' : ''}`)
		},
		cancel() {
			abort.abort()
		},
	})

	const res = new Response(stream, {
		headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
	})
	if (quota) res.headers.set('X-Loci-Quota-Remaining', String(quota.remaining))
	return withCookie(res, cookie)
}

const TIMED = { thought: 'first thought', say: 'first sentence', action: 'first drawing' } as const

/** When the first of each kind of event left the server, for the terminal log. */
class TurnTiming {
	private start = performance.now()
	private firsts = new Map<string, number>()

	saw(event: TutorEvent) {
		const label = TIMED[event.type as keyof typeof TIMED]
		if (label && !this.firsts.has(label)) this.firsts.set(label, performance.now() - this.start)
	}

	summary() {
		const parts = [...this.firsts].map(([label, ms]) => `${label} ${seconds(ms)}`)
		parts.push(`done ${seconds(performance.now() - this.start)}`)
		return parts.join(' · ')
	}
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`
