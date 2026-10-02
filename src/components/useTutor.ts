'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from 'tldraw'
import { lastMark, runTutorTurn } from '@/lib/tutor/client'
import { clearConversation, loadConversation, saveConversation, type Turn } from '@/lib/storage/conversation'
import { moveTutorTo, setTutorMode } from '@/lib/canvas/presence'
import { speak, stopSpeaking } from '@/lib/voice/speech'
import { describeSelection } from './selection'

export interface TutorStatus {
	configured: boolean
	provider?: string
	model?: string
	setupHint?: string
	checked: boolean
}

export function useTutor(editor: Editor | null, voiceOut: boolean) {
	const [turns, setTurns] = useState<Turn[]>([])
	const [status, setStatus] = useState<TutorStatus>({ configured: true, checked: false })
	const abortRef = useRef<AbortController | null>(null)
	const voiceRef = useRef(voiceOut)
	voiceRef.current = voiceOut
	const loaded = useRef(false)

	useEffect(() => {
		loadConversation().then((t) => {
			setTurns(t)
			loaded.current = true
		})
		fetch('/api/tutor')
			.then((r) => r.json())
			.then((s) => setStatus({ ...s, checked: true }))
			.catch(() => setStatus({ configured: false, checked: true, setupHint: 'Could not reach the local server.' }))
	}, [])

	useEffect(() => {
		if (loaded.current) saveConversation(turns).catch(() => {})
	}, [turns])

	const busy = turns.some((t) => ['looking', 'thinking', 'teaching'].includes(t.status))

	const ask = useCallback(
		async (question: string) => {
			if (!editor || busy || !question.trim()) return
			stopSpeaking()
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
			setTutorMode('thinking')
			try {
				const result = await runTutorTurn(
					editor,
					question.trim(),
					history,
					turnNumber,
					{
						onPhase: (phase) => patch((t) => ({ ...t, status: phase })),
						onSay: (text) => {
							patch((t) => ({ ...t, said: [...t.said, text] }))
							if (voiceRef.current) speak(text)
						},
						onAction: (action, summary) => patch((t) => ({ ...t, actions: [...t.actions, summary], lastAction: action.type })),
						onNotice: (message) => patch((t) => ({ ...t, notices: [...(t.notices ?? []), message] })),
						beforeDraw: moveTutorTo,
					},
					controller.signal
				)
				patch((t) => ({ ...t, status: result.error ? 'error' : 'done', error: result.error }))
			} catch (err) {
				const aborted = controller.signal.aborted
				patch((t) => ({ ...t, status: aborted ? 'stopped' : 'error', error: aborted ? undefined : (err as Error).message }))
			} finally {
				abortRef.current = null
				setTutorMode('idle')
			}
		},
		[editor, busy, turns]
	)

	const stop = useCallback(() => {
		abortRef.current?.abort()
		stopSpeaking()
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

	const reset = useCallback(async () => {
		stop()
		setTurns([])
		await clearConversation()
	}, [stop])

	return { turns, busy, status, ask, stop, undoLastTurn, reset }
}
