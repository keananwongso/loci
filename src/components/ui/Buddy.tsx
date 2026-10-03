'use client'
import { useEffect, useRef } from 'react'
import { useEditor, useValue } from 'tldraw'
import { buddyAsked, buddyStatus, buddyThought, heard, tutorPresence, type BuddyThought } from '@/lib/canvas/presence'
import { renderLatex } from '@/lib/canvas/katex'
import { micLevel, voiceLevel } from '@/lib/voice/level'

const N = 170
const SEEDS = Array.from({ length: N }, (_, i) => {
	const y = 1 - (2 * (i + 0.5)) / N
	const r = Math.sqrt(1 - y * y)
	const a = i * 2.399963229728653
	return { x: Math.cos(a) * r, y, z: Math.sin(a) * r, a }
})

type Rgb = readonly [number, number, number]
const BLUE: Rgb = [36, 87, 230]
const VIOLET: Rgb = [116, 69, 224]
const ORANGE: Rgb = [224, 103, 15]
const mix = (a: Rgb, b: Rgb, k: number): Rgb => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]

/** Where the buddy rests relative to the student's cursor, like a companion beside it. */
const REST = { x: 30, y: 30 }

/**
 * The tutor's presence: a small particle orb in the board's own ink. It rests beside your cursor,
 * listens while you hold to talk, swirls while it thinks, flies to wherever it draws and pulses
 * with its voice. Drawn every frame straight to a canvas; React only mounts it.
 */
export function Buddy() {
	const editor = useEditor()
	const root = useRef<HTMLDivElement>(null)
	const canvas = useRef<HTMLCanvasElement>(null)
	const words = useValue('heard', () => heard.get(), [])
	const status = useValue('buddy-status', () => buddyStatus.get(), [])
	const listening = useValue('buddy-listening', () => tutorPresence.get().mode === 'listening', [])
	const hint = listening ? (words ? lastWords(words) : 'Listening · drag to highlight') : status
	const thought = useValue('buddy-thought', () => buddyThought.get(), [])
	const asked = useValue('buddy-asked', () => buddyAsked.get(), [])
	// Keep the last words on screen while they fade out.
	const shownThought = useRef<BuddyThought | null>(null)
	if (thought) shownThought.current = thought
	const shownAsked = useRef('')
	if (asked) shownAsked.current = asked

	useEffect(() => {
		const el = root.current
		const cv = canvas.current
		if (!el || !cv) return
		const g = cv.getContext('2d')
		if (!g) return
		const reduce = matchMedia('(prefers-reduced-motion: reduce)')

		let pointer: { x: number; y: number } | null = null
		const onMove = (e: PointerEvent) => {
			if (e.pointerType === 'touch') return
			const b = editor.getViewportScreenBounds()
			pointer = { x: e.clientX - b.x, y: e.clientY - b.y }
		}
		window.addEventListener('pointermove', onMove, { passive: true })

		const vp = editor.getViewportScreenBounds()
		const pos = { x: vp.w - 120, y: vp.h - 200 }
		const vel = { x: 0, y: 0 }
		let env = 0
		let spin = 0
		let last = performance.now()
		let frame = 0
		let mode = ''

		const tick = (now: number) => {
			const dt = Math.min(0.05, (now - last) / 1000)
			last = now
			const t = now / 1000
			const p = tutorPresence.get()
			const still = reduce.matches

			// Target: the pen while it is drawing, otherwise beside the cursor.
			let target: { x: number; y: number }
			if (p.away) target = editor.pageToViewport({ x: p.x, y: p.y })
			else if (pointer) target = { x: pointer.x + REST.x, y: pointer.y + REST.y }
			else {
				const b = editor.getViewportScreenBounds()
				target = { x: b.w - 120, y: b.h - 200 }
			}
			// A soft spring: it trails the cursor and glides across the board instead of jumping.
			const k = p.away ? 0.075 : 0.11
			vel.x = (vel.x + (target.x - pos.x) * k) * 0.74
			vel.y = (vel.y + (target.y - pos.y) * k) * 0.74
			pos.x += vel.x
			pos.y += vel.y
			const bob = still || p.away ? 0 : Math.sin(t * 1.8) * 2
			el.style.transform = `translate(${pos.x.toFixed(1)}px, ${(pos.y + bob).toFixed(1)}px)`
			// The thought line sits to the right, or to the left near the right edge of the screen.
			const side = pos.x > editor.getViewportScreenBounds().w - 300 ? 'left' : 'right'
			if (el.dataset.side !== side) el.dataset.side = side
			if (mode !== p.mode) {
				mode = p.mode
				el.dataset.mode = mode
			}

			const level = p.mode === 'listening' ? micLevel() : voiceLevel()
			env += (level - env) * (level > env ? 0.5 : 0.12)
			const speaking = env > 0.02
			spin += dt * (p.mode === 'thinking' ? 2.4 : p.mode === 'listening' ? 1.1 : 0.6)

			// Size the canvas to the screen once, then draw.
			const dpr = Math.min(devicePixelRatio || 1, 2)
			const size = Math.round(72 * dpr)
			if (cv.width !== size) cv.width = cv.height = size
			g.setTransform(dpr, 0, 0, dpr, 0, 0)
			g.clearRect(0, 0, 72, 72)

			const listening = p.mode === 'listening'
			const R = (listening ? 13.5 : p.mode === 'idle' ? 11 : 12.5) * (1 + 0.35 * env) + (still ? 0 : Math.sin(t * 2.2) * 0.4)
			const base = listening ? mix(BLUE, ORANGE, 0.75) : p.mode === 'thinking' ? mix(BLUE, VIOLET, 0.7) : BLUE
			const glow = g.createRadialGradient(36, 36, 0, 36, 36, R * 2.6)
			glow.addColorStop(0, `rgba(${base.map(Math.round).join(',')},${0.16 + 0.22 * env})`)
			glow.addColorStop(1, `rgba(${base.map(Math.round).join(',')},0)`)
			g.fillStyle = glow
			g.fillRect(0, 0, 72, 72)

			const cs = Math.cos(still ? 0.6 : spin)
			const sn = Math.sin(still ? 0.6 : spin)
			const tilt = 0.38
			const ct = Math.cos(tilt)
			const st = Math.sin(tilt)
			for (const s of SEEDS) {
				const x = s.x * cs + s.z * sn
				const z0 = s.z * cs - s.x * sn
				const y = s.y * ct - z0 * st
				const z = s.y * st + z0 * ct
				const lobe = still ? 0 : Math.sin(s.y * 3 + t * (speaking ? 7 : 2.4) + s.a * 0.05) * (0.04 + 0.3 * env)
				const r = R * (1 + lobe)
				const depth = (z + 1) / 2
				const c = mix(base, VIOLET, listening ? 0 : (1 - s.y) * 0.25)
				g.fillStyle = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${(0.18 + 0.82 * depth).toFixed(3)})`
				const d = 0.55 + 1.05 * depth
				g.fillRect(36 + x * r - d / 2, 36 + y * r - d / 2, d, d)
			}
			frame = requestAnimationFrame(tick)
		}
		frame = requestAnimationFrame(tick)
		el.dataset.ready = 'true'

		return () => {
			cancelAnimationFrame(frame)
			window.removeEventListener('pointermove', onMove)
		}
	}, [editor])

	return (
		<div className="loci-buddy" ref={root} aria-hidden>
			<canvas ref={canvas} />
			<span className="loci-buddy__hint" data-show={Boolean(hint)}>
				{hint}
			</span>
			<span className="loci-buddy__asked loci-hand" data-show={Boolean(asked)}>
				{clip(shownAsked.current, 60)}
			</span>
			<span className="loci-buddy__thought loci-hand" data-show={Boolean(thought)}>
				{shownThought.current && <ThoughtLine key={thoughtKey(shownThought.current)} thought={shownThought.current} />}
			</span>
		</div>
	)
}

/** The tail of a long transcript, so the hint stays one short line. */
function lastWords(text: string) {
	const w = text.split(/\s+/)
	return w.length > 8 ? `…${w.slice(-8).join(' ')}` : text
}

const thoughtKey = (t: BuddyThought) => `${t.text}|${t.latex ?? ''}`

/** One line of what the tutor is doing; remounts on change so the new words write themselves in. */
function ThoughtLine({ thought }: { thought: BuddyThought }) {
	return (
		<span className="loci-buddy__thought-line">
			{thought.text}
			{thought.latex && <span className="loci-buddy__thought-math" dangerouslySetInnerHTML={{ __html: renderLatex(thought.latex.slice(0, 120), false) }} />}
		</span>
	)
}

function clip(text: string, max: number) {
	return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}
