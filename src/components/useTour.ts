'use client'
/**
 * The guided first run, driven by the demo pack. The tutor speaks each step's instruction and points
 * at what to ask about. Visitor questions always go to the live model. In record mode (the local admin) the same steps ask the live model instead,
 * and each answer can be kept as the branch's take.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@/lib/whiteboard'
import { emphasize, endTutorTurn, heard, lookAt, setTutorMode } from '@/lib/canvas/presence'
import { loadPack, loadPackVoice, placePack, pointArea } from '@/lib/demo/client'
import { pickBranch, type DemoBranch, type DemoPack, type DemoStep } from '@/lib/demo/pack'
import { playSpeech, prepareSpeech, stopAllSpeech } from '@/lib/voice/player'
import type { TurnResult } from '@/lib/tutor/client'
import type { AskOptions } from './useTutor'

export type TourPhase = 'off' | 'start' | 'running' | 'finished'

/** An answer recorded in record mode, waiting to be kept or redone. */
export interface Recorded {
	step: DemoStep
	branch: DemoBranch
	question: string
	result: TurnResult
}

const DONE_KEY = 'loci:tour-done'

export function tourDone() {
	try {
		return localStorage.getItem(DONE_KEY) === '1'
	} catch {
		return false
	}
}

export function markDone() {
	try {
		localStorage.setItem(DONE_KEY, '1')
	} catch {}
}

interface Deps {
	editor: Editor
	ask: (question: string, opts?: AskOptions) => Promise<TurnResult | null>
	busy: boolean
	/** Empty the board and the conversation. */
	clear: () => Promise<void>
	setVoiceOut: (on: boolean) => void
	setLoading: (message: string | null) => void
	record: boolean
}

export function useTour({ editor, ask, busy, clear, setVoiceOut, setLoading, record }: Deps) {
	const [pack, setPack] = useState<DemoPack | null>(null)
	const [phase, setPhase] = useState<TourPhase>('off')
	const [coachDismissed, setCoachDismissed] = useState(false)
	const [index, setIndex] = useState(0)
	/** The line the tutor is saying (the step's instruction), shown in the coach card. */
	const [line, setLine] = useState('')
	const [speaking, setSpeaking] = useState(false)
	const [recorded, setRecorded] = useState<Recorded | null>(null)
	/** The step whose instruction has started (the coach card waits for it). */
	const [entered, setEntered] = useState(-1)
	/** Whether any answer in this run was a recorded take, so the end card can say so honestly. */
	const [replayed, setReplayed] = useState(false)
	const run = useRef(0)

	useEffect(() => {
		loadPack().then(setPack)
	}, [])

	const step = phase === 'running' && entered === index ? pack?.steps[index] : undefined

	/** Say one of the pack's lines, pointing at `area` while it is said. */
	const say = useCallback(async (text: string | undefined, area?: { x: number; y: number; w: number; h: number } | null) => {
		if (!text) return
		const at = run.current
		setLine(text)
		setSpeaking(true)
		if (area) {
			lookAt(area)
			emphasize(area, 4000)
		}
		try {
			await playSpeech(prepareSpeech(text)).done
		} finally {
			if (run.current === at) {
				setSpeaking(false)
				endTutorTurn()
			}
		}
	}, [])

	const enterStep = useCallback(
		async (i: number) => {
			if (!pack) return
			setIndex(i)
			setCoachDismissed(false)
			setEntered(i)
			setRecorded(null)
			const next = pack.steps[i]
			if (!next) {
				setLine('')
				setPhase('finished')
				if (!record) markDone()
				// The next action is shown in the end card.
				return
			}
			setLine(next.intro ?? '')
			await say(next.intro, pointArea(editor, next)?.area)
		},
		[pack, editor, say, record],
	)

	/** Show the start card. */
	const open = useCallback(() => {
		stopAllSpeech()
		setRecorded(null)
		setPhase('start')
	}, [])

	/** The visitor pressed start: a fresh board with the pack, voice on, then the instruction card. */
	const begin = useCallback(async () => {
		if (!pack) return
		const at = ++run.current
		setVoiceOut(true)
		await clear()
		setPhase('running')
		setIndex(0)
		setEntered(-1)
		setReplayed(false)
		setLine('')
		setLoading('Setting up the board…')
		await Promise.all([placePack(editor, pack), loadPackVoice()])
		setLoading(null)
		if (run.current !== at) return
		if (!record) markDone()
		await enterStep(0)
	}, [pack, editor, clear, setVoiceOut, setLoading, enterStep])

	const skip = useCallback(() => {
		run.current++
		stopAllSpeech()
		endTutorTurn()
		setLine('')
		setRecorded(null)
		setPhase('finished')
		if (!record) markDone()
	}, [record])

	const close = useCallback(() => {
		run.current++
		stopAllSpeech()
		endTutorTurn()
		setPhase('off')
		setLine('')
	}, [])

	/** Point at the step's phrase again (the visitor hovers the hint, or waits too long). */
	const pointAgain = useCallback(() => {
		const area = step ? pointArea(editor, step)?.area : null
		if (area) emphasize(area, 2600)
	}, [editor, step])

	/**
	 * Ask during the tour: send the real question to the model, then advance after the answer. Outside the tour, a plain question.
	 */
	const tourAsk = useCallback(
		async (question: string, opts: AskOptions = {}, forceBranch?: DemoBranch): Promise<TurnResult | null> => {
			if (!step || coachDismissed || busy || !question.trim()) return ask(question, opts)
			const at = ++run.current
			// Final-only recognizers still get a brief, truthful read-along update before sending.
			if (!record && opts.spoken) {
				heard.set(question)
				setTutorMode('transcribing')
				await new Promise((resolve) => setTimeout(resolve, 450))
				if (run.current !== at) return null
			}
			if (!record) setCoachDismissed(true)
			stopAllSpeech()
			setSpeaking(false)
			const branch = forceBranch ?? (step.kind === 'ask' ? pickBranch(step, '') : pickBranch(step, question))
			// A live answer needs to see what the step is about.
			if (step.kind === 'ask' && editor.getSelectedShapeIds().length === 0) {
				const target = pointArea(editor, step)?.page
				if (target) editor.select(target.id)
			}
			const result = await ask(question, { ...opts, guidedDemo: !record && index === 0 })
			if (run.current !== at) return result
			if (result?.error) { setCoachDismissed(false); return result }
			if (!result) {
				// Interrupting an accepted question leaves onboarding behind.
				if (!record) { setPhase('off'); markDone() }
				return result
			}
			if (record) {
				setRecorded({ step, branch, question, result })
				return result
			}
			if (branch.next === 'continue') await enterStep(index + 1)
			return result
		},
		[step, coachDismissed, busy, ask, record, editor, enterStep, index],
	)

	/** Record mode: go on to the next step without keeping anything. */
	const nextStep = useCallback(() => enterStep(index + 1), [enterStep, index])

	// A visitor who doesn't act on an ask step gets pointed at the phrase again now and then.
	useEffect(() => {
		if (!step?.point || speaking || busy) return
		const t = setInterval(pointAgain, 6000)
		return () => clearInterval(t)
	}, [step, speaking, busy, pointAgain])

	return {
		pack,
		phase,
		coachDismissed,
		index,
		step,
		line,
		speaking,
		recorded,
		replayed,
		setRecorded,
		open,
		begin,
		skip,
		close,
		ask: tourAsk,
		nextStep,
		pointAgain,
		setPack,
	}
}
