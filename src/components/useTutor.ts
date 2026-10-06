'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@/lib/whiteboard'
import { lastMark, runTutorTurn } from '@/lib/tutor/client'
import { clearConversation, loadConversation, saveConversation, type Turn } from '@/lib/storage/conversation'
import { clearThinking, endTutorTurn, lookAt, lookAtWhileTalking, moveTutorTo, setBuddyStatus, setThought, showAsked } from '@/lib/canvas/presence'
import { playAck, wantsAck } from '@/lib/voice/ack'
import { endTimeline, mark, startTimeline } from '@/lib/tutor/timeline'
import { playSpeech, prepareSpeech, stopAllSpeech, type PreparedSpeech } from '@/lib/voice/player'
import { ackKindFor, describeSelection, firstThought } from './selection'
import { loadUserKey, type UserKey } from '@/lib/storage/userKey'
import { REGION } from '@/lib/canvas/shape-types'
import type { TurnResult } from '@/lib/tutor/client'
import { recordLesson } from '@/lib/tutor/recording'
import { saveLesson } from '@/lib/storage/lesson'
import type { Take } from '@/lib/demo/pack'

export interface AskOptions {
	spoken?: boolean
	guidedDemo?: boolean
	/** Replay this recorded answer instead of asking the model. */
	take?: Take
}

export interface TutorStatus {
	configured: boolean
	provider?: string
	model?: string
	setupHint?: string
	checked: boolean
	/** Running as a public demo with free-question limits. */
	hosted?: boolean
	accounts?: boolean
	signedIn?: boolean
	pro?: boolean
	/** Free questions left today on this device (hosted demo). */
	quota?: { limit: number; remaining: number }
}

export function useTutor(editor: Editor | null, voiceOut: boolean, boardId = 'default') {
	const [turns, setTurns] = useState<Turn[]>([])
	const [saving, setSaving] = useState(false)
	const [status, setStatus] = useState<TutorStatus>({ configured: true, checked: false })
	const abortRef = useRef<AbortController | null>(null)
	const voiceRef = useRef(voiceOut)
	voiceRef.current = voiceOut
	const loaded = useRef(false)
	const [ready, setReady] = useState(false)
	const [userKey, setUserKey] = useState<UserKey | null>(null)

	useEffect(() => {
		const sync = () => setUserKey(loadUserKey())
		sync()
		window.addEventListener('loci:user-key', sync)
		return () => window.removeEventListener('loci:user-key', sync)
	}, [])

	const resets = useRef(0)
	useEffect(() => {
		const at = resets.current
		lastMark.clear()
		loadConversation(boardId).then((t) => {
			// A reset that happened while loading wins.
			if (resets.current === at) setTurns(t)
			loaded.current = true
			setReady(true)
		}).catch(() => { loaded.current = true; setReady(true); setStatus((s) => ({ ...s, setupHint: 'Browser storage is unavailable; your conversation cannot be restored.' })) })
		fetch('/api/tutor')
			.then((r) => r.json())
			.then((s) => setStatus({ ...s, checked: true }))
			.catch(() => setStatus({ configured: false, checked: true, setupHint: 'Could not reach the local server.' }))
	}, [])

	useEffect(() => {
		if (loaded.current) saveConversation(turns, boardId).catch(() => {})
	}, [turns])

	useEffect(() => () => { abortRef.current?.abort(); stopAllSpeech() }, [])

	const busy = !ready || saving || turns.some((t) => ['looking', 'thinking', 'teaching'].includes(t.status))

	const ask = useCallback(
		async (question: string, opts: AskOptions = {}): Promise<TurnResult | null> => {
			if (!editor || busy || !question.trim()) {
				setBuddyStatus('')
				endTutorTurn()
				return null
			}
			stopAllSpeech()
			// Out of free questions: say so straight away instead of acting out an answer the server will refuse.
			if (!opts.take && status.hosted && !userKey && status.quota?.remaining === 0) {
				setBuddyStatus('')
				endTutorTurn()
				setTurns((ts) => [
					...ts,
					{
						id: crypto.randomUUID(),
						turn: (ts.at(-1)?.turn ?? 0) + 1,
						question: question.trim(),
						context: describeSelection(editor),
						said: [],
						actions: [],
						status: 'error',
						error: status.pro ? 'Your questions for this billing month are used up.' : "You've used today's free questions on this device.",
						limitReached: status.pro ? 'subscription' : 'device',
					},
				])
				if (!status.accounts && !status.pro) window.dispatchEvent(new CustomEvent('loci:open-key-dialog'))
				return null
			}
			setSaving(true)
			if (!opts.spoken) startTimeline('asked')
			// Instant feedback, before any model has answered: fly to what they pointed at, show what
			// was heard and what it is looking at, and in voice mode acknowledge out loud.
			// The area the student dragged out is a pointing gesture for this one question.
			const regions = editor
				.getSelectedShapes()
				.filter((s) => s.type === REGION)
				.map((s) => s.id)
			const focus = editor.getSelectionPageBounds()
			lookAt(focus ? { x: focus.x, y: focus.y, w: focus.w, h: focus.h } : null)
			setBuddyStatus('')
			setThought(firstThought(editor))
			if (opts.spoken) showAsked(question.trim())
			// "Let me look" only for real questions, not "hi", thanks, or answers to its own question.
			const lastSaid = turns.at(-1)?.said.at(-1)
			const leadIn = voiceRef.current && wantsAck(question, lastSaid) ? playAck(ackKindFor(editor)).done : undefined
			// The thinking line folds away the moment the answer starts: first words heard, or first mark.
			let answering = false
			const answerStarted = () => {
				if (answering) return
				answering = true
				clearThinking()
			}
			const id = crypto.randomUUID()
			const turnNumber = (turns.at(-1)?.turn ?? 0) + 1
			const history = turns
				.filter((t) => t.status !== 'error')
				.map((t) => ({ question: t.question, answer: t.said.join('\n'), actions: t.actions }))
			const newTurn: Turn = {
				id,
				turn: turnNumber,
				question: question.trim(),
				context: describeSelection(editor),
				said: [],
				actions: [],
				status: 'looking',
			}
			setTurns((ts) => [...ts, newTurn])
			const patch = (fn: (t: Turn) => Turn) => setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t)))

			const controller = new AbortController()
			abortRef.current = controller
			let outcome: TurnResult | null = null
			const recording = recordLesson(editor, id)
			try {
				const result = await runTutorTurn(
					editor,
					question.trim(),
					history,
					turnNumber,
					{
						onPhase: (phase) => patch((t) => ({ ...t, status: phase })),
						onThought: (thought) => {
							if (!answering) setThought(thought)
						},
						prepareSay: (text) => (voiceRef.current ? prepareSpeech(text) : undefined),
						onSay: (text, prepared) => {
							patch((t) => ({ ...t, said: [...t.said, text] }))
							if (!prepared) {
								recording.cue(text)
								answerStarted()
								return undefined
							}
							const playback = playSpeech(prepared as PreparedSpeech)
							playback.started.then(() => {
								const cue = recording.cue(text, true)
								recording.audio(cue, (prepared as PreparedSpeech).recording)
								playback.done.then(() => recording.endCue(cue))
								answerStarted()
								mark('first sentence audible')
							})
							return playback
						},
						onAction: (action, summary) => {
							patch((t) => ({ ...t, actions: [...t.actions, summary], lastAction: action.type }))
							answerStarted()
							mark('first mark drawn')
						},
						onLook: lookAtWhileTalking,
						onNotice: (message) => patch((t) => ({ ...t, notices: [...(t.notices ?? []), message] })),
						beforeDraw: moveTutorTo,
					},
					controller.signal,
					{ ...opts, leadIn }
				)
				outcome = result
				patch((t) => ({ ...t, status: result.error ? 'error' : 'done', error: result.error, limitReached: result.limitReached }))
				if (result.limitReached && result.limitReached !== 'store' && !status.accounts && !status.pro) window.dispatchEvent(new CustomEvent('loci:open-key-dialog'))
				if (result.quotaRemaining !== undefined) {
					setStatus((st) => ({ ...st, quota: { limit: st.quota?.limit ?? result.quotaRemaining!, remaining: result.quotaRemaining! } }))
				}
			} catch (err) {
				const aborted = controller.signal.aborted
				patch((t) => ({ ...t, status: aborted ? 'stopped' : 'error', error: aborted ? undefined : (err as Error).message }))
			} finally {
				try {
					const lesson = await recording.finish()
					if (lesson.cues.length || lesson.frames.length) {
						await saveLesson(id, lesson)
						patch((t) => ({ ...t, lessonId: id }))
					}
				} catch { patch((t) => ({ ...t, notices: [...(t.notices ?? []), 'Could not save this replay. Browser storage may be full.'] })) }
				abortRef.current = null
				setSaving(false)
				setBuddyStatus('')
				endTutorTurn()
				endTimeline()
				const stale = regions.filter((id) => editor.getShape(id))
				if (stale.length) editor.run(() => editor.deleteShapes(stale), { history: 'ignore' })
			}
			return outcome
		},
		[editor, busy, turns, status, userKey]
	)

	const stop = useCallback(() => {
		abortRef.current?.abort()
		stopAllSpeech()
	}, [])

	/** Remove everything the tutor drew in the latest turn. */
	const undoLastTurn = useCallback(() => {
		const last = turns.at(-1)
		if (!editor || !last) return
		const mark = lastMark.get(last.turn)
		if (mark) {
			// Reverts everything since the turn started, including additions to older graphs.
			editor.bailToMark(mark)
			lastMark.delete(last.turn)
		} else {
			// After a reload the history is gone: remove the objects this turn created.
			const ids = editor
				.getCurrentPageShapes()
				.filter((s) => {
					const meta = s.meta as { author?: string; turn?: number }
					return meta.author === 'assistant' && meta.turn === last.turn
				})
				.map((s) => s.id)
			editor.deleteShapes(ids)
		}
		setTurns((ts) => ts.map((t) => (t.id === last.id ? { ...t, undone: true } : t)))
	}, [editor, turns])

	/** Remove everything Loci drew, in every answer, keeping the student's own material and marks. Undoable. */
	const eraseDrawings = useCallback(() => {
		if (!editor) return 0
		const ids = editor
			.getCurrentPageShapes()
			.filter((s) => (s.meta as { author?: string }).author === 'assistant')
			.map((s) => s.id)
		if (ids.length) {
			editor.markHistoryStoppingPoint('erase-loci-drawings')
			editor.deleteShapes(ids)
		}
		return ids.length
	}, [editor])

	const reset = useCallback(async () => {
		resets.current++
		stop()
		setTurns([])
		await clearConversation(boardId)
	}, [stop, boardId])

	// A visitor's own key counts as configured even when the server has none.
	const effective: TutorStatus = userKey ? { ...status, configured: true, provider: userKey.provider, model: userKey.model || `${userKey.provider} (your key)` } : status

	return { turns, busy, ready, status: effective, userKey, ask, stop, undoLastTurn, eraseDrawings, reset }
}
