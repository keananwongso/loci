'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Whiteboard, useEditor } from '@/lib/whiteboard'
import { shapeUtils } from '../canvasConfig'
import { loadLesson, createLessonPlayback, writingClip, type LessonRecording } from '@/lib/storage/lesson'
import { getBlobUrl } from '@/lib/storage/blobs'
import { renderRich } from '@/lib/canvas/richtext'
import { speak, stopSpeaking } from '@/lib/voice/speech'
import { stopAllSpeech } from '@/lib/voice/player'
import { CloseIcon, SkipIcon, PlayIcon, PauseIcon, MoreIcon } from './icons'

// A brief silent clip unlocks this element when playback begins before the first spoken cue.
const SILENT_AUDIO = 'data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA=='

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${Math.floor(ms / 1000 % 60).toString().padStart(2, '0')}`

export function LessonPlayer({ id, question, onClose, inline = false }: { id: string; question: string; onClose?: () => void; inline?: boolean }) {
	const liveEditor = useEditor()
	const [lesson, setLesson] = useState<LessonRecording | null>(null)
	const [error, setError] = useState('')
	const [time, setTime] = useState(0)
	const [playing, setPlaying] = useState(false)
	const [rate, setRate] = useState(1)
	const [transcript, setTranscript] = useState(false)
	const draw = useRef<ReturnType<typeof createLessonPlayback> | null>(null)
	const audioAttempt = useRef(0)
	const audioRef = useRef<HTMLAudioElement | null>(null)
	const urls = useRef(new Map<string, string>())
	const position = useRef(0)
	const activeCue = useRef(-1)
	const seeking = useRef(true)

	useEffect(() => {
		if (inline) return
		const readonly = liveEditor.getInstanceState().isReadonly
		liveEditor.updateInstanceState({ isReadonly: true })
		return () => { liveEditor.updateInstanceState({ isReadonly: readonly }) }
	}, [liveEditor, inline])

	useEffect(() => {
		if (!inline) stopAllSpeech()
		let cancelled = false
		loadLesson(id).then(async (recording) => {
			if (!recording) throw new Error('This replay is no longer in browser storage.')
			await Promise.all(recording.cues.map(async (cue) => {
				if (!cue.audioKey) return
				const url = await getBlobUrl(cue.audioKey).catch(() => undefined)
				if (url) urls.current.set(cue.audioKey, url)
			}))
			if (!cancelled) { setLesson(recording); if (inline) { position.current = recording.duration; setTime(recording.duration) } }
		}).catch(() => { if (!cancelled) setError('Could not open this replay from browser storage.') })
		return () => { cancelled = true; audioAttempt.current++; audioRef.current?.pause(); if (activeCue.current >= 0) stopSpeaking() }
	}, [id, inline])

	const render = useCallback((at: number, seek = false) => {
		draw.current?.(at, seek)
	}, [])

	const startCue = useCallback((at: number) => {
		const audio = audioRef.current
		if (!audio || !lesson) return
		const index = lesson.cues.findIndex((cue) => at >= cue.start && at < cue.end)
		const cue = lesson.cues[index]
		const attempt = ++audioAttempt.current
		audio.pause()
		stopSpeaking()
		activeCue.current = index
		seeking.current = false
		if (!cue) {
			audio.src = SILENT_AUDIO
			void audio.play().catch(() => {})
			return
		}
		const url = cue.audioKey && urls.current.get(cue.audioKey)
		if (url) {
			// Start in the Play/seek gesture, preserving browser permission to play audible media.
			if (audio.src !== url) audio.src = url
			audio.currentTime = Math.max(0, (at - cue.start) / 1000)
			audio.playbackRate = rate
			void audio.play().catch((err: unknown) => {
				if (attempt !== audioAttempt.current) return
				if ((err as DOMException).name === 'NotAllowedError') {
					setPlaying(false)
					setError('Your browser blocked replay audio. Press play to try again.')
				} else if (cue.voiced) {
					// Missing or damaged saved clips can still use the local browser voice.
					speak(cue.text, undefined, undefined, rate)
				}
			})
		} else if (cue.voiced) speak(cue.text, undefined, undefined, rate)
	}, [lesson, rate])

	const seek = useCallback((at: number) => {
		if (!lesson) return
		position.current = Math.max(0, Math.min(lesson.duration, at))
		seeking.current = true
		audioAttempt.current++
		audioRef.current?.pause()
		stopSpeaking()
		activeCue.current = -1
		setTime(position.current)
		render(position.current, true)
		if (playing) startCue(position.current)
	}, [lesson, render, playing, startCue])

	useEffect(() => {
		if (!playing || !lesson) { audioAttempt.current++; audioRef.current?.pause(); stopSpeaking(); return }
		let frame = 0
		let last = performance.now()
		let lastUi = -Infinity
		const tick = (now: number) => {
			const audio = audioRef.current
			const active = lesson.cues[activeCue.current]
			const hasClip = active?.audioKey && urls.current.has(active.audioKey)
			if (hasClip && audio && !audio.paused && !audio.ended) {
				// Buffering holds the playhead at the audible position instead of repeatedly jumping back.
				position.current = Math.min(lesson.duration, active.start + audio.currentTime * 1000)
			} else {
				position.current = Math.min(lesson.duration, position.current + (now - last) * rate)
			}
			last = now
			const at = position.current
			const index = lesson.cues.findIndex((cue) => at >= cue.start && at < cue.end)
			if (index !== activeCue.current || seeking.current) startCue(at)
			if (now - lastUi >= 33 || at >= lesson.duration) { setTime(at); lastUi = now }
			render(at)
			if (at >= lesson.duration) { setPlaying(false); return }
			frame = requestAnimationFrame(tick)
		}
		frame = requestAnimationFrame(tick)
		return () => cancelAnimationFrame(frame)
	}, [playing, lesson, rate, render, startCue])

	const togglePlay = () => {
		if (!lesson) return
		if (playing) { audioAttempt.current++; audioRef.current?.pause(); stopSpeaking(); setPlaying(false); return }
		if (position.current >= lesson.duration) seek(0)
		setError('')
		startCue(position.current)
		setPlaying(true)
	}

	const cue = lesson?.cues.find((cue) => time >= cue.start && time < cue.end) ?? (inline && !playing ? lesson?.cues.at(-1) : undefined)
	return <section className="loci-player" aria-label="Explanation playback" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()} onKeyDown={(e) => {
		if (e.key === 'Escape') { e.preventDefault(); onClose?.(); return }
		if ((e.target as HTMLElement).matches('input, select, button')) return
		if (e.code === 'Space') { e.preventDefault(); togglePlay() }
		if (e.code === 'ArrowLeft') { e.preventDefault(); seek(position.current - 10000) }
		if (e.code === 'ArrowRight') { e.preventDefault(); seek(position.current + 10000) }
	}}>
		{lesson && !inline && createPortal(<div className="loci-replay-canvas" aria-label="Replaying explanation on the board"><style>{lesson.writing?.map((w) => { const clip = writingClip(w, time); return clip ? `.loci-replay-canvas .loci-shape[data-shape-id="${CSS.escape(w.shapeId)}"] { clip-path: ${clip}; }` : '' }).join('\n')}</style><Whiteboard shapeUtils={shapeUtils} snapshot={lesson.baseline} hideUi onMount={(editor) => { editor.updateInstanceState({ isReadonly: true }); draw.current = createLessonPlayback(editor, lesson); draw.current(position.current, true) }} /></div>, liveEditor.getContainer())}
		{!inline && <header><span title={question}>Review · {question}</span><button className="loci-icon-btn loci-icon-btn--sm" onClick={onClose} aria-label="Finish replay" title="Return to your board"><CloseIcon /></button></header>}
		{error && <p className="loci-player__error" role="alert">{error}</p>}
		{lesson ? <>
			{transcript && <aside className="loci-player__transcript" aria-label="Clickable transcript">
				<button className="loci-player__collapse" onClick={() => setTranscript(false)}>Hide transcript</button>
				{lesson.cues.map((cue, index) => <button key={index} data-active={time >= cue.start && time < cue.end} onClick={() => seek(cue.start)}><time>{clock(cue.start)}</time><span dangerouslySetInnerHTML={{ __html: renderRich(cue.text) }} /></button>)}
				{!lesson.cues.length && <p>This explanation has drawing only.</p>}
			</aside>}
			{!transcript && cue && <button className="loci-player__caption" aria-label="Expand transcript" aria-expanded={false} title="Show full transcript" onClick={() => setTranscript(true)} dangerouslySetInnerHTML={{ __html: renderRich(cue.text) }} />}
			<div className="loci-player__controls">
                <button onClick={() => seek(position.current - 10000)} className="loci-player__skip" aria-label="Rewind 10 seconds" title="Back 10 seconds"><SkipIcon /><b>10</b></button>
                <button className="loci-player__play" onClick={togglePlay} aria-label={playing ? 'Pause explanation' : 'Play explanation'}>{playing ? <PauseIcon /> : <PlayIcon />}</button>
                <input aria-label="Explanation timeline" type="range" min="0" max={Math.ceil(lesson.duration)} step="1" value={Math.ceil(time)} onChange={(e) => seek(Number(e.target.value))} />
                <button onClick={() => seek(position.current + 10000)} className="loci-player__skip" aria-label="Forward 10 seconds" title="Forward 10 seconds"><SkipIcon forward /><b>10</b></button>
                <span className="loci-player__time">{clock(time)} / {clock(lesson.duration)}</span>
                <details className="loci-player__menu"><summary aria-label="Playback options" title="Playback options"><MoreIcon /></summary><div>
                 <label>Speed<select aria-label="Playback speed" value={rate} onChange={(e) => { const next = Number(e.target.value); if (audioRef.current) audioRef.current.playbackRate = next; seeking.current = true; setRate(next) }}>{[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => <option key={r} value={r}>{r}×</option>)}</select></label>
                 <button aria-pressed={transcript} onClick={(e) => { setTranscript(!transcript); e.currentTarget.closest('details')?.removeAttribute('open') }}>{transcript ? 'Hide transcript' : 'Show transcript'}</button>
                </div></details>
			</div>
		</> : !error && <p>Opening the saved explanation…</p>}
		<audio ref={audioRef} preload="auto" />
	</section>
}
