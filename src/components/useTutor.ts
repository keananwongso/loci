'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from 'tldraw'
import { lastMark, runTutorTurn } from '@/lib/tutor/client'
import { clearConversation, loadConversation, saveConversation, type Turn } from '@/lib/storage/conversation'
import { moveTutorTo, setTutorMode } from '@/lib/canvas/presence'
import { playSpeech, prepareSpeech, stopAllSpeech, type PreparedSpeech } from '@/lib/voice/player'
import { setOrbState } from '@/lib/voice/orb'
import { describeSelection } from './selection'
import { loadUserKey, type UserKey } from '@/lib/storage/userKey'

export interface TutorStatus {
	configured: boolean
	provider?: string
	model?: string
	setupHint?: string
	checked: boolean
	/** Running as a public demo with free-question limits. */
	hosted?: boolean
	/** Free questions left today on this device (hosted demo). */
	quota?: { limit: number; remaining: number }
}

export function useTutor(editor: Editor | null, voiceOut: boolean) {
	const [turns, setTurns] = useState<Turn[]>([])
	const [status, setStatus] = useState<TutorStatus>({ configured: true, checked: false })
	const abortRef = useRef<AbortController | null>(null)
	const voiceRef = useRef(voiceOut)
	voiceRef.current = voiceOut
	const loaded = useRef(false)
	const [userKey, setUserKey] = useState<UserKey | null>(null)

	useEffect(() => {
		const sync = () => setUserKey(loadUserKey())
		sync()
		window.addEventListener('loci:user-key', sync)
		return () => window.removeEventListener('loci:user-key', sync)
	}, [])

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
		async (question: string, opts: { scripted?: boolean } = {}) => {
			if (!editor || busy || !question.trim()) return
			stopAllSpeech()
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
			setOrbState('thinking')
			try {
				const result = await runTutorTurn(
					editor,
					question.trim(),
					history,
					turnNumber,
					{
						onPhase: (phase) => patch((t) => ({ ...t, status: phase })),
						prepareSay: (text) => (voiceRef.current ? prepareSpeech(text) : undefined),
						onSay: async (text, prepared) => {
							patch((t) => ({ ...t, said: [...t.said, text] }))
							if (prepared) await playSpeech(prepared as PreparedSpeech)
						},
						onAction: (action, summary) => patch((t) => ({ ...t, actions: [...t.actions, summary], lastAction: action.type })),
						onNotice: (message) => patch((t) => ({ ...t, notices: [...(t.notices ?? []), message] })),
						beforeDraw: moveTutorTo,
					},
					controller.signal,
					opts
				)
				patch((t) => ({ ...t, status: result.error ? 'error' : 'done', error: result.error, limitReached: result.limitReached }))
				if (result.quotaRemaining !== undefined) {
					setStatus((st) => ({ ...st, quota: { limit: st.quota?.limit ?? result.quotaRemaining!, remaining: result.quotaRemaining! } }))
				}
			} catch (err) {
				const aborted = controller.signal.aborted
				patch((t) => ({ ...t, status: aborted ? 'stopped' : 'error', error: aborted ? undefined : (err as Error).message }))
			} finally {
				abortRef.current = null
				setTutorMode('idle')
				setOrbState('listening')
			}
		},
		[editor, busy, turns]
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

	const reset = useCallback(async () => {
		stop()
		setTurns([])
		await clearConversation()
	}, [stop])

	// A visitor's own key counts as configured even when the server has none.
	const effective: TutorStatus = userKey ? { ...status, configured: true, provider: userKey.provider, model: userKey.model || `${userKey.provider} (your key)` } : status

	return { turns, busy, status: effective, userKey, ask, stop, undoLastTurn, reset }
}
