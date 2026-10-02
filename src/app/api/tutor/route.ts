/**
 * Local tutor endpoint. Runs on the user's own machine (`npm run dev`); it holds the
 * provider API key server-side, forwards only the context for this one question to the
 * configured model, and streams validated canvas actions back as newline-delimited JSON.
 * Nothing is stored here.
 */
import { getToolDefinitions } from '@/lib/actions/tools'
import { getProvider } from '@/lib/providers'
import { buildTurnText, SYSTEM_PROMPT } from '@/lib/tutor/prompt'
import { ActionSession } from '@/lib/tutor/session'
import { TutorRequestSchema, type TutorEvent } from '@/lib/tutor/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 24 * 1024 * 1024

export async function GET() {
	try {
		const provider = getProvider()
		return Response.json({
			provider: provider.name,
			model: provider.model,
			configured: provider.isConfigured(),
			setupHint: provider.setupHint,
		})
	} catch (err) {
		return Response.json({ configured: false, setupHint: (err as Error).message }, { status: 500 })
	}
}

export async function POST(req: Request) {
	const length = Number(req.headers.get('content-length') ?? 0)
	if (length > MAX_BODY_BYTES) return Response.json({ error: 'Request too large.' }, { status: 413 })

	const parsed = TutorRequestSchema.safeParse(await req.json().catch(() => null))
	if (!parsed.success) {
		return Response.json({ error: 'Invalid request.', details: parsed.error.issues.slice(0, 5) }, { status: 400 })
	}
	const request = parsed.data

	let provider
	try {
		provider = getProvider()
	} catch (err) {
		return Response.json({ error: (err as Error).message }, { status: 500 })
	}
	if (!provider.isConfigured()) {
		return Response.json({ error: `No model configured. ${provider.setupHint}` }, { status: 503 })
	}

	const encoder = new TextEncoder()
	const abort = new AbortController()
	req.signal.addEventListener('abort', () => abort.abort())

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const emit = (event: TutorEvent) => {
				if (abort.signal.aborted) return
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
		},
		cancel() {
			abort.abort()
		},
	})

	return new Response(stream, {
		headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
	})
}
