'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createShapeId, useEditor } from 'tldraw'
import { REGION, type RegionShape } from '@/lib/canvas/shape-types'
import { clearThinking, heard, setBuddyStatus, setThought, setTutorMode } from '@/lib/canvas/presence'
import { endTimeline, mark as markTime, startTimeline } from '@/lib/tutor/timeline'
import { canRecognize, startListening } from '@/lib/voice/speech'
import { startRecording, transcribe, within, type Recording } from '@/lib/voice/recorder'
import { stopAllSpeech } from '@/lib/voice/player'
import { listenEndSound, listenStartSound } from '@/lib/voice/earcon'

interface Props {
	busy: boolean
	/** Returns false when the question could not be asked (for example, a turn is still running). */
	onAsk: (question: string, opts: { spoken: true }) => unknown
	onStop: () => void
	disabled?: boolean
	/** Voice answers are on: acknowledge out loud the moment the keys come up. */
	voice?: boolean
}

type Pt = { x: number; y: number }

const isTalkCombo = (e: KeyboardEvent) => e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey && (e.key === 'Control' || e.key === 'Alt')

/**
 * Hold Ctrl + Alt (⌃ + ⌥ on a Mac) and talk; recording starts the moment the keys go down. While the keys are down the board becomes a
 * highlighter: drag over whatever you mean, or click an object, and Loci looks there. Release to
 * ask. Holding while Loci is talking interrupts it.
 */
export function HoldToTalk({ busy, onAsk, onStop, disabled, voice }: Props) {
	const editor = useEditor()
	const [holding, setHolding] = useState(false)
	const [stroke, setStroke] = useState<Pt[]>([])
	const [fading, setFading] = useState<Pt[] | null>(null)
	const drawing = useRef(false)
	const points = useRef<Pt[]>([])
	const marked = useRef(false)
	const stopRec = useRef<(() => Promise<string>) | null>(null)
	const recording = useRef<Recording | null>(null)
	const live = useRef({ busy, onAsk, onStop, disabled, voice })
	live.current = { busy, onAsk, onStop, disabled, voice }

	const begin = useCallback(() => {
		if (live.current.disabled) return
		if (live.current.busy) live.current.onStop()
		stopAllSpeech()
		marked.current = false
		heard.set('')
		clearThinking()
		setBuddyStatus('')
		setHolding(true)
		setTutorMode('listening')
		listenStartSound()
		recording.current = startRecording()
		// Live words under the buddy, and a fallback transcript when Fish Audio is not set up.
		stopRec.current = canRecognize() ? startListening((t) => heard.set(t), () => {}) : null
	}, [])

	const end = useCallback(async () => {
		setHolding(false)
		drawing.current = false
		setStroke([])
		// Feedback the instant the keys come up, before the words are even transcribed.
		startTimeline('released the talk keys')
		listenEndSound()
		setTutorMode('transcribing')
		setBuddyStatus('')
		setThought({ text: 'got it…' })
		const rec = recording.current
		const words = stopRec.current
		recording.current = null
		stopRec.current = null
		const browserWords = words ? within(words().catch(() => ''), 2000, heard.get()) : Promise.resolve(heard.get())
		const clip = rec ? await rec.stop().catch(() => null) : null
		// Clips under about half a second are a tap, not a question.
		const spoke = Boolean(clip && clip.size > 3000)
		const browserText = await browserWords
		// Fish is more accurate; if the browser already heard words, don't wait long for it.
		const fish = spoke ? await transcribe(clip!, browserText.trim() ? 3500 : 7000) : null
		const transcript = (fish ?? browserText).trim()
		heard.set(transcript)
		markTime('transcript ready')
		console.info('[loci] hold to talk:', { recordedBytes: clip?.size ?? 0, fish, browser: browserText, asking: transcript })
		if (transcript) {
			Promise.resolve(live.current.onAsk(transcript, { spoken: true })).then((asked) => {
				if (asked === false) setBuddyStatus('Still busy. Hold again to interrupt.', 3000)
			})
			return
		}
		clearThinking()
		endTimeline('nothing to ask')
		heard.set('')
		setTutorMode('idle')
		if (marked.current) {
			// Pointed at something but said nothing: type the question instead.
			setBuddyStatus('')
			window.dispatchEvent(new CustomEvent('loci:focus-prompt'))
		} else if (spoke) setBuddyStatus("Didn't catch that. Hold and try again?", 3000)
		else if (!clip) setBuddyStatus("Couldn't use your mic. Check the browser's mic permission.", 4000)
		else setBuddyStatus('')
	}, [editor])

	useEffect(() => {
		let down = false
		const onKeyDown = (e: KeyboardEvent) => {
			if (down || e.repeat || !isTalkCombo(e)) return
			e.preventDefault()
			down = true
			begin()
		}
		const release = () => {
			if (!down) return
			down = false
			end()
		}
		const onKeyUp = (e: KeyboardEvent) => {
			if (e.key === 'Control' || e.key === 'Alt') release()
		}
		window.addEventListener('keydown', onKeyDown, true)
		window.addEventListener('keyup', onKeyUp, true)
		window.addEventListener('blur', release)
		return () => {
			window.removeEventListener('keydown', onKeyDown, true)
			window.removeEventListener('keyup', onKeyUp, true)
			window.removeEventListener('blur', release)
		}
	}, [begin, end])

	const point = (e: React.PointerEvent): Pt => ({ x: e.clientX, y: e.clientY })

	/** Ask about what was marked: a dragged stroke becomes a region, a click selects that object. */
	const mark = (pts: Pt[]) => {
		const xs = pts.map((p) => p.x)
		const ys = pts.map((p) => p.y)
		const a = editor.screenToPage({ x: Math.min(...xs), y: Math.min(...ys) })
		const b = editor.screenToPage({ x: Math.max(...xs), y: Math.max(...ys) })
		const old = editor
			.getCurrentPageShapes()
			.filter((s) => s.type === REGION)
			.map((s) => s.id)
		if (old.length) editor.deleteShapes(old)
		if (Math.hypot(b.x - a.x, b.y - a.y) * editor.getZoomLevel() < 10) {
			const hit = editor.getShapeAtPoint(a, { hitInside: true, margin: 6 })
			if (hit) editor.select(hit.id)
			else editor.selectNone()
		} else {
			const pad = 6 / editor.getZoomLevel()
			const id = createShapeId()
			editor.createShape<RegionShape>({
				id,
				type: REGION,
				x: a.x - pad,
				y: a.y - pad,
				props: { w: b.x - a.x + pad * 2, h: b.y - a.y + pad * 2 },
			})
			editor.select(id)
		}
		marked.current = true
	}

	return (
		<>
			{holding && (
				<div
					className="loci-talk"
					onContextMenu={(e) => e.preventDefault()}
					onPointerDown={(e) => {
						e.preventDefault()
						e.currentTarget.setPointerCapture(e.pointerId)
						drawing.current = true
						points.current = [point(e)]
						setStroke(points.current)
					}}
					onPointerMove={(e) => {
						if (!drawing.current) return
						points.current = [...points.current, point(e)]
						setStroke(points.current)
					}}
					onPointerUp={(e) => {
						if (!drawing.current) return
						drawing.current = false
						const pts = [...points.current, point(e)]
						mark(pts)
						setFading(pts)
						setStroke([])
						setTimeout(() => setFading((f) => (f === pts ? null : f)), 900)
					}}
				>
					<svg className="loci-talk__ink">
						{stroke.length > 0 && <polyline points={stroke.map((p) => `${p.x},${p.y}`).join(' ')} />}
					</svg>
				</div>
			)}
			{fading && (
				<svg className="loci-talk__ink loci-talk__ink--fading" aria-hidden>
					<polyline points={fading.map((p) => `${p.x},${p.y}`).join(' ')} />
				</svg>
			)}
		</>
	)
}
