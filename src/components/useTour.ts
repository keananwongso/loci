'use client'
/**
 * The guided first run, driven by the demo pack. The tutor speaks each step's instruction and points
 * at what to ask about; whatever the visitor then asks or answers (by voice, typing or the suggested
 * chip) is matched to a branch, and that branch's recorded take replays: the real gesture, a fixed
 * answer, no model call. In record mode (the local admin) the same steps ask the live model instead,
 * and each answer can be kept as the branch's take.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from 'tldraw'
import { emphasize, endTutorTurn, lookAt } from '@/lib/canvas/presence'
import { loadPack, loadPackVoice, loadTake, placePack, pointArea } from '@/lib/demo/client'
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

function markDone() {
	try {
		localStorage.setItem(DONE_KEY, '1')
	} catch {}
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
			setEntered(i)
			setRecorded(null)
			const next = pack.steps[i]
			if (!next) {
				setLine('')
				setPhase('finished')
				if (!record) markDone()
				await say(pack.outro)
				return
			}
			setLine(next.intro ?? '')
			await say(next.intro, pointArea(editor, next)?.area)
		},
		[pack, editor, say, record]
	)

	/** Show the start card. */
	const open = useCallback(() => {
		stopAllSpeech()
		setRecorded(null)
		setPhase('start')
	}, [])

	/** The visitor pressed start: a fresh board with the pack, voice on, the greeting, then step one. */
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
		const first = editor.getCurrentPageShapes()[0]
		const b = first && editor.getShapePageBounds(first)
		await say(pack.greeting, b ? { x: b.x, y: b.y, w: b.w, h: Math.min(b.h, 200) } : null)
		if (run.current !== at) return
		await wait(250)
		await enterStep(0)
	}, [pack, editor, clear, setVoiceOut, setLoading, say, enterStep])

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
		setPhase('off')
		setLine('')
	}, [])

	/** Point at the step's phrase again (the visitor hovers the hint, or waits too long). */
	const pointAgain = useCallback(() => {
		const area = step ? pointArea(editor, step)?.area : null
		if (area) emphasize(area, 2600)
	}, [editor, step])

	/**
	 * Ask during the tour: pick the branch, replay its take (or, in record mode or without a take,
	 * ask the model), then move on as the branch says. Outside the tour, a plain question.
	 */
	const tourAsk = useCallback(
		async (question: string, opts: AskOptions = {}, forceBranch?: DemoBranch): Promise<TurnResult | null> => {
			if (!step) return ask(question, opts)
			run.current++
			stopAllSpeech()
			setSpeaking(false)
			const branch = forceBranch ?? (step.kind === 'ask' ? pickBranch(step, '') : pickBranch(step, question))
			const take = !record && branch.take ? await loadTake(branch.take) : null
			// A live answer needs to see what the step is about.
			if (!take && step.kind === 'ask' && editor.getSelectedShapeIds().length === 0) {
				const target = pointArea(editor, step)?.page
				if (target) editor.select(target.id)
			}
			const result = await ask(question, { ...opts, take: take ?? undefined })
			if (!result || result.error) return result
			if (take) setReplayed(true)
			if (record) {
				setRecorded({ step, branch, question, result })
				return result
			}
			if (branch.next === 'continue') await enterStep(index + 1)
			return result
		},
		[step, ask, record, editor, enterStep, index]
	)

	/** Record mode: go on to the next step without keeping anything. */
	const nextStep = useCallback(() => enterStep(index + 1), [enterStep, index])

	// A visitor who doesn't act on an ask step gets pointed at the phrase again now and then.
	useEffect(() => {
		if (!step?.point || speaking || busy) return
		const t = setInterval(pointAgain, 6000)
		return () => clearInterval(t)
	}, [step, speaking, busy, pointAgain])

	return { pack, phase, index, step, line, speaking, recorded, replayed, setRecorded, open, begin, skip, close, ask: tourAsk, nextStep, pointAgain, setPack }
}
