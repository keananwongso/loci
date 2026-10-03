'use client'
/**
 * Browser side of a tutoring turn: gather context, call the local /api/tutor route, and
 * replay the streamed events in order. Speech and drawing share one queue: a sentence starts,
 * the marks after it are drawn while it is spoken, and the next sentence waits for it to end.
 */
import type { Editor } from 'tldraw'
import { CanvasExecutor, type BeforeDraw } from '@/lib/canvas/executor'
import { captureImages, serializeBoard } from '@/lib/canvas/serialize'
import type { CanvasAction } from '@/lib/actions/schema'
import { TutorRequestSchema, type HistoryTurn, type TutorEvent, type TutorRequest } from './types'
import { userKeyHeaders } from '@/lib/storage/userKey'
import { mark } from './timeline'

export interface SayPlayback {
	started: Promise<void>
	done: Promise<void>
}

/** The longest the drawing waits for a slow voice before carrying on without it. */
const MAX_VOICE_WAIT = 7000

export interface TurnCallbacks {
	onPhase(phase: 'looking' | 'thinking' | 'teaching'): void
	/**
	 * Called in order. In voice mode it returns the sentence's playback: the marks after it wait
	 * until the voice is audible, and the next sentence waits until it has finished.
	 */
	onSay(text: string, prepared?: unknown): void | SayPlayback
	/** Called the moment a sentence arrives, so speech can be synthesized ahead of its turn. */
	prepareSay?(text: string): unknown
	onAction(action: CanvasAction, summary: string): void
	onNotice(message: string): void
	/** What the tutor is doing while it works, before the answer starts. */
	onThought?(thought: { text: string; latex?: string }): void
	beforeDraw: BeforeDraw
}

/** History mark per turn (this session only); used to undo a whole turn precisely. */
export const lastMark = new Map<number, string>()

export interface TurnResult {
	error?: string
	/** Set when the hosted demo's free-question limit refused the request. */
	limitReached?: string
	/** Free questions left today (hosted demo), when the server reports it. */
	quotaRemaining?: number
}

export interface TurnOptions {
	/** Replay the free scripted lesson instead of calling a model. */
	scripted?: boolean
	/** Speech already playing (the instant acknowledgement); the first sentence waits for it. */
	leadIn?: Promise<void>
}

export async function runTutorTurn(
	editor: Editor,
	question: string,
	history: HistoryTurn[],
	turn: number,
	cb: TurnCallbacks,
	signal: AbortSignal,
	opts: TurnOptions = {}
): Promise<TurnResult> {
	cb.onPhase('looking')
	const focus = serializeBoard(editor)
	const images = await captureImages(editor, focus)
	const request = fitRequest({ question, board: focus.board, images, history: history.slice(-12), turn })
	const regionText = focus.board.region?.text?.replace(/\s+/g, ' ').trim()
	if (regionText) cb.onThought?.({ text: `reading “${regionText.length > 34 ? `${regionText.slice(0, 33).trimEnd()}…` : regionText}”` })

	cb.onPhase('thinking')
	const res = await fetch('/api/tutor', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...(opts.scripted ? { 'x-loci-demo': 'scripted' } : userKeyHeaders()) },
		body: JSON.stringify(request),
		signal,
	})
	if (!res.ok || !res.body) {
		const body = await res.json().catch(() => ({}))
		return { error: body.error ?? `Request failed (${res.status})`, limitReached: body.limitReached, quotaRemaining: body.quota?.remaining }
	}
	const quotaHeader = res.headers.get('X-Loci-Quota-Remaining')
	const quotaRemaining = quotaHeader === null ? undefined : Number(quotaHeader)

	lastMark.set(turn, editor.markHistoryStoppingPoint(`tutor-turn-${turn}`))
	const executor = new CanvasExecutor(editor, turn, cb.beforeDraw)
	// Frame from the region the student drew, if any; whole pages are too big to keep framed.
	if (focus.board.region) executor.focusContext([focus.board.region.id])

	// One ordered queue for speech and drawing.
	let queue = Promise.resolve()
	// The sentence being spoken. Drawing carries on under it; the next sentence waits for it.
	let speaking: Promise<void> = opts.leadIn?.catch(() => {}) ?? Promise.resolve()
	let error: string | undefined
	let started = false
	const enqueue = (fn: () => Promise<void> | void) => {
		queue = queue.then(async () => {
			if (signal.aborted) return
			try {
				await fn()
			} catch (err) {
				console.warn('[loci] could not apply action', err)
			}
		})
	}
	const handle = (event: TutorEvent) => {
		if (!started && (event.type === 'say' || event.type === 'action')) {
			started = true
			cb.onPhase('teaching')
		}
		switch (event.type) {
			case 'say': {
				const prepared = cb.prepareSay?.(event.text)
				enqueue(async () => {
					await speaking
					if (signal.aborted) return
					const playback = cb.onSay(event.text, prepared)
					if (!playback) return
					speaking = playback.done.catch(() => {})
					// Draw what this sentence talks about while it is being said, not before.
					await Promise.race([playback.started, new Promise((r) => setTimeout(r, MAX_VOICE_WAIT))])
				})
				break
			}
			case 'action':
				enqueue(async () => {
					await executor.execute(event.action)
					cb.onAction(event.action, event.summary)
				})
				break
			case 'rejected':
				// The model sees the reason and usually retries; only log it.
				console.info(`[loci] ${event.tool} rejected: ${event.reason}`)
				break
			case 'thought':
				// Not queued: it describes what is coming, and is hidden once the answer starts.
				mark('first thought from the model')
				cb.onThought?.({ text: event.text, latex: event.latex })
				break
			case 'status':
				enqueue(() => cb.onNotice(event.message))
				break
			case 'error':
				error = event.message
				break
		}
	}

	const reader = res.body.getReader()
	const decoder = new TextDecoder()
	let buffer = ''
	for (;;) {
		const { value, done } = await reader.read()
		if (done) break
		buffer += decoder.decode(value, { stream: true })
		let nl: number
		while ((nl = buffer.indexOf('\n')) >= 0) {
			const line = buffer.slice(0, nl).trim()
			buffer = buffer.slice(nl + 1)
			if (!line) continue
			try {
				handle(JSON.parse(line) as TutorEvent)
			} catch {
				console.warn('[loci] bad stream line')
			}
		}
	}
	await queue
	await speaking
	return { error, quotaRemaining }
}

/**
 * Check the request against the schema the server enforces, and drop any board object, image or
 * earlier turn that would fail it, so one odd drawing never blocks every later question. What was
 * dropped, and why, is logged.
 */
export function fitRequest(request: TutorRequest): TutorRequest {
	for (let attempt = 0; attempt < 5; attempt++) {
		const parsed = TutorRequestSchema.safeParse(request)
		if (parsed.success) return request
		const drop = { objects: new Set<number>(), images: new Set<number>(), history: new Set<number>() }
		for (const issue of parsed.error.issues) {
			const [a, b, c] = issue.path
			const where = issue.path.join('.')
			if (a === 'board' && b === 'objects' && typeof c === 'number') drop.objects.add(c)
			else if (a === 'images' && typeof b === 'number') drop.images.add(b)
			else if (a === 'history' && typeof b === 'number') drop.history.add(b)
			else {
				console.warn(`[loci] request does not fit the schema at ${where}: ${issue.message}`)
				continue
			}
			console.warn(`[loci] left out ${where} from the request: ${issue.message}`)
		}
		if (!drop.objects.size && !drop.images.size && !drop.history.size) return request
		request = {
			...request,
			board: { ...request.board, objects: request.board.objects.filter((_, i) => !drop.objects.has(i)) },
			images: request.images.filter((_, i) => !drop.images.has(i)),
			history: request.history.filter((_, i) => !drop.history.has(i)),
		}
	}
	return request
}
