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
import type { HistoryTurn, TutorEvent, TutorRequest } from './types'
import { userKeyHeaders } from '@/lib/storage/userKey'

export interface TurnCallbacks {
	onPhase(phase: 'looking' | 'thinking' | 'teaching'): void
	/** Called in order; may return a promise (voice mode) that resolves once the sentence has been spoken. */
	onSay(text: string, prepared?: unknown): void | Promise<void>
	/** Called the moment a sentence arrives, so speech can be synthesized ahead of its turn. */
	prepareSay?(text: string): unknown
	onAction(action: CanvasAction, summary: string): void
	onNotice(message: string): void
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
	const request: TutorRequest = { question, board: focus.board, images, history: history.slice(-12), turn }

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
	let speaking: Promise<void> = Promise.resolve()
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
					speaking = Promise.resolve(cb.onSay(event.text, prepared)).catch(() => {})
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
