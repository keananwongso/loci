'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createShapeId, useEditor } from 'tldraw'
import { REGION, type RegionShape } from '@/lib/canvas/shape-types'
import { heard, setTutorMode } from '@/lib/canvas/presence'
import { canRecognize, startListening } from '@/lib/voice/speech'
import { startMic, stopMic } from '@/lib/voice/level'
import { stopAllSpeech } from '@/lib/voice/player'

interface Props {
	busy: boolean
	onAsk: (question: string) => void
	onStop: () => void
	disabled?: boolean
}

type Pt = { x: number; y: number }

const isTalkCombo = (e: KeyboardEvent) => e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey && (e.key === 'Control' || e.key === 'Alt')

/**
 * Hold Ctrl + Alt (⌃ + ⌥ on a Mac) and talk. While the keys are down the board becomes a
 * highlighter: drag over whatever you mean, or click an object, and Loci looks there. Release to
 * ask. Holding while Loci is talking interrupts it.
 */
export function HoldToTalk({ busy, onAsk, onStop, disabled }: Props) {
	const editor = useEditor()
	const [holding, setHolding] = useState(false)
	const [stroke, setStroke] = useState<Pt[]>([])
	const [fading, setFading] = useState<Pt[] | null>(null)
	const drawing = useRef(false)
	const points = useRef<Pt[]>([])
	const marked = useRef(false)
	const stopRec = useRef<(() => Promise<string>) | null>(null)
	const live = useRef({ busy, onAsk, onStop, disabled })
	live.current = { busy, onAsk, onStop, disabled }

	const begin = useCallback(() => {
		if (live.current.disabled) return
		if (live.current.busy) live.current.onStop()
		stopAllSpeech()
		marked.current = false
		heard.set('')
		setHolding(true)
		setTutorMode('listening')
		startMic()
		stopRec.current = canRecognize() ? startListening((t) => heard.set(t), () => {}) : null
	}, [])

	const end = useCallback(async () => {
		setHolding(false)
		drawing.current = false
		setStroke([])
		stopMic()
		const transcript = stopRec.current ? await stopRec.current() : ''
		stopRec.current = null
		heard.set('')
		setTutorMode('idle')
		if (transcript.trim()) live.current.onAsk(transcript)
		// Pointed at something but said nothing (or no speech recognition): type the question.
		else if (marked.current) window.dispatchEvent(new CustomEvent('loci:focus-prompt'))
	}, [])

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
