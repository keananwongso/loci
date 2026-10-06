import { readLimitedJson, refuseCrossOrigin } from '@/lib/server/request'
/**
 * Local tutor endpoint. Runs on the user's own machine (`npm run dev`); it holds the
 * provider API key server-side, forwards only the context for this one question to the
 * configured model, and streams validated canvas actions back as newline-delimited JSON.
 * Nothing is stored here.
 */
import { getToolDefinitions } from '@/lib/actions/tools'
import { getProvider, providerForUserKey } from '@/lib/providers'
import type { TutorModelProvider } from '@/lib/providers/types'
import { deviceFor, ipHashFor } from '@/lib/server/device'
import { VISIT_LIMITS, limitConfigFromEnv, readQuota, takeQuestion, takeUsage, type Quota } from '@/lib/server/limits'
import { authConfigured } from '@/lib/server/auth'
import { meterId, viewer } from '@/lib/server/billing'
import { paidQuota, paidUsage } from '@/lib/server/paid-usage'
import { countryOf, recordStats } from '@/lib/server/stats'
import { buildTurnText, SYSTEM_PROMPT, GUIDED_DEMO_PROMPT } from '@/lib/tutor/prompt'
import { ActionSession } from '@/lib/tutor/session'
import { TutorRequestSchema, type TutorEvent, type TutorRequest } from '@/lib/tutor/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Long tutoring turns stream for a while; hosts like Vercel cap this per plan.
export const maxDuration = 300

const MAX_BODY_BYTES = 24 * 1024 * 1024

export async function GET(req: Request) {
	const limits = limitConfigFromEnv()
	const device = deviceFor(req)
	let quota: Quota | undefined
	// Signed in or not matters even without hosted limits; the top bar shows it.
	const who = await viewer().catch(() => ({ paid: null, userId: null }))
	if (limits.enabled) quota = await Promise.resolve().then(() => readQuota(limits, meterId(device.id, who.userId), ipHashFor(req))).catch(() => undefined)
	// The board asks for this once when it opens, so it doubles as the visitor count. On a hosted
	// demo the count is capped per network, since anyone can call this in a loop.
	const counted =
		!limits.enabled ||
		(await Promise.resolve()
			.then(() => takeUsage('visit', VISIT_LIMITS, device.id, ipHashFor(req)))
			.then((d) => d.ok, () => false))
	if (counted) await recordStats({ visits: 1 }, { id: device.id, country: countryOf(req), unique: 'visitors' })
	try {
		const provider = getProvider()
		const account = limits.enabled ? who.paid : null
		if (account) quota = await paidQuota(account)
		return withCookie(
			Response.json({
				provider: provider.name,
				model: provider.model,
				configured: provider.isConfigured(),
				setupHint: provider.setupHint,
				hosted: limits.enabled,
				accounts: authConfigured(),
				signedIn: Boolean(who.userId),
				pro: Boolean(account),
				quota,
			}),
			device.setCookie,
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
 * Which model answers: the visitor's own key (sent in headers for this
 * request only, never stored or logged), or the server's key under the demo limits.
 */
async function chooseProvider(
	req: Request,
	request: TutorRequest,
): Promise<{ provider: TutorModelProvider; quota?: Quota; cookie?: string; ownerPays?: { id: string; country?: string } } | Response> {
	const userKey = req.headers.get('x-loci-key')
	if (userKey) {
		try {
			return {
				provider: providerForUserKey(req.headers.get('x-loci-provider') ?? '', userKey, req.headers.get('x-loci-model')?.slice(0, 120) || undefined),
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
	const device = deviceFor(req)
	if (!limits.enabled) return { provider, cookie: device.setCookie, ownerPays: { id: device.id, country: countryOf(req) } }
	let who: Awaited<ReturnType<typeof viewer>>
	try {
		who = await viewer()
		const account = who.paid
		if (account) {
			const usage = await paidUsage(account, 'question', 1)
			if (!usage.ok) return Response.json({ error: usage.reason === 'subscription' ? 'Your questions for this billing month are used up.' : usage.reason === 'daily' ? 'Your daily question allowance is used up. More questions tomorrow.' : 'Loci is at capacity today. Please try again tomorrow.', limitReached: usage.reason, quota: usage.quota }, { status: 429 })
			return { provider, quota: usage.quota, cookie: device.setCookie, ownerPays: { id: account.user_id, country: countryOf(req) } }
		}
	} catch (err) {
		console.error('[loci] subscription check failed:', err instanceof Error ? err.message : err)
		return Response.json({ error: 'Could not check your subscription. Please try again.', limitReached: 'store' }, { status: 503 })
	}
	const decision = await Promise.resolve()
		.then(() => takeQuestion(limits, meterId(device.id, who.userId), ipHashFor(req)))
		.catch(() => null)
	if (!decision)
		return withCookie(
			Response.json({ error: 'The free demo is temporarily unavailable. Please try again later.', limitReached: 'store' }, { status: 503 }),
			device.setCookie,
		)
	if (!decision.ok) {
		// Only a returning browser is attributed, so cookie-less retries can't mint visitors.
		await recordStats({ refused: 1 }, device.setCookie ? undefined : { id: device.id, country: countryOf(req) })
		return withCookie(
			Response.json({ error: LIMIT_MESSAGES[decision.reason], limitReached: decision.reason, quota: decision.quota }, { status: 429 }),
			device.setCookie,
		)
	}
	return { provider, quota: decision.quota, cookie: device.setCookie, ownerPays: { id: device.id, country: countryOf(req) } }
}

export async function POST(req: Request) {

	const refusedOrigin = refuseCrossOrigin(req)
	if (refusedOrigin) return refusedOrigin
	const body = await readLimitedJson(req, MAX_BODY_BYTES)
	if (body instanceof Response) return body
	const parsed = TutorRequestSchema.safeParse(body.value)
	if (!parsed.success) {
		const where = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`)
		console.warn(`[loci] rejected a tutor request: ${where.join('; ')}`)
		return Response.json({ error: 'Invalid request.', details: parsed.error.issues.slice(0, 5) }, { status: 400 })
	}
	const request = parsed.data

	const chosen = await chooseProvider(req, request)
	if (chosen instanceof Response) return chosen
	const { provider, quota, cookie, ownerPays } = chosen
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
			// Only turns on the owner's key are counted; a visitor's own key is their spend.
			const tokens = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 }
			try {
				await provider.run(
					{
						system: SYSTEM_PROMPT + (request.guidedDemo ? GUIDED_DEMO_PROMPT : ''),
						tools: getToolDefinitions(),
						request,
						turnText: buildTurnText(request),
						onUsage: (u) => {
							tokens.inputTokens += u.input
							tokens.cachedTokens += u.cachedInput
							tokens.outputTokens += u.output
						},
					},
					session,
					emit,
					abort.signal,
				)
			} catch (err) {
				if (!abort.signal.aborted) {
					console.error('[loci] tutor request failed:', err instanceof Error ? err.message : err)
					emit({ type: 'error', message: provider.describeError?.(err) ?? (err instanceof Error ? err.message : String(err)) })
				}
			}
			emit({ type: 'done' })
			if (ownerPays) await recordStats({ questions: 1, ...tokens }, { ...ownerPays, unique: 'askers' })
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
	res.headers.set('X-Loci-Model', `${provider.name}/${provider.model}`)
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
