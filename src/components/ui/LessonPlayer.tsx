'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Tldraw, useEditor, type Editor } from 'tldraw'
import { shapeUtils, assetUrls } from '../canvasConfig'
import { loadLesson, lessonAt, writingClip, type LessonRecording } from '@/lib/storage/lesson'
import { getBlobUrl } from '@/lib/storage/blobs'
import { renderRich } from '@/lib/canvas/richtext'
import { speak, stopSpeaking } from '@/lib/voice/speech'
import { stopAllSpeech } from '@/lib/voice/player'
import { CloseIcon } from './icons'

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${Math.floor(ms / 1000 % 60).toString().padStart(2, '0')}`

export function LessonPlayer({ id, question, onClose }: { id: string; question: string; onClose: () => void }) {
	const liveEditor = useEditor()
	const [lesson, setLesson] = useState<LessonRecording | null>(null)
	const [error, setError] = useState('')
	const [time, setTime] = useState(0)
	const [playing, setPlaying] = useState(false)
	const [rate, setRate] = useState(1)
	const [transcript, setTranscript] = useState(false)
	const editorRef = useRef<Editor | null>(null)
	const audioRef = useRef<HTMLAudioElement | null>(null)
	const urls = useRef(new Map<string, string>())
	const position = useRef(0)
	const activeCue = useRef(-1)
	const seeking = useRef(true)

	useEffect(() => {
		const readonly = liveEditor.getInstanceState().isReadonly
		liveEditor.updateInstanceState({ isReadonly: true })
		return () => { liveEditor.updateInstanceState({ isReadonly: readonly }) }
	}, [liveEditor])

	useEffect(() => {
		stopAllSpeech()
		let cancelled = false
		loadLesson(id).then(async (recording) => {
			if (!recording) throw new Error('This replay is no longer in browser storage.')
			await Promise.all(recording.cues.map(async (cue) => {
				if (!cue.audioKey) return
				const url = await getBlobUrl(cue.audioKey)
				if (url) urls.current.set(cue.audioKey, url)
			}))
			if (!cancelled) setLesson(recording)
		}).catch(() => { if (!cancelled) setError('Could not open this replay from browser storage.') })
		return () => { cancelled = true; audioRef.current?.pause(); stopSpeaking() }
	}, [id])

	const render = useCallback((at: number) => {
		const editor = editorRef.current
		if (!editor || !lesson) return
		const state = lessonAt(lesson, at)
		editor.loadSnapshot(state.snapshot)
		editor.setCamera(state.camera)
		editor.updateInstanceState({ isReadonly: true })
	}, [lesson])

	const seek = useCallback((at: number) => {
		if (!lesson) return
		position.current = Math.max(0, Math.min(lesson.duration, at))
		seeking.current = true
		audioRef.current?.pause()
		stopSpeaking()
		activeCue.current = -1
		setTime(position.current)
		render(position.current)
	}, [lesson, render])

	useEffect(() => {
		if (!playing || !lesson) { audioRef.current?.pause(); stopSpeaking(); return }
		let frame = 0
		let last = performance.now()
		let lastRendered = -Infinity
		const tick = (now: number) => {
			position.current = Math.min(lesson.duration, position.current + (now - last) * rate)
			last = now
			const at = position.current
			setTime(at)
			if (seeking.current || at - lastRendered >= 100) { render(at); lastRendered = at }
			const index = lesson.cues.findIndex((cue) => at >= cue.start && at < cue.end)
			const cue = lesson.cues[index]
			const audio = audioRef.current
			if (audio && cue) {
				const url = cue.audioKey && urls.current.get(cue.audioKey)
				if (index !== activeCue.current || seeking.current) {
					audio.pause()
					stopSpeaking()
					if (url) {
						audio.src = url
						audio.currentTime = Math.max(0, (at - cue.start) / 1000)
						audio.playbackRate = rate
						audio.play().catch(() => { setPlaying(false); setError('Press play to enable audio in your browser.') })
					} else if (cue.voiced) speak(cue.text, undefined, undefined, rate)
					activeCue.current = index
				} else if (url) {
					audio.playbackRate = rate
					if (audio.paused && !audio.ended) void audio.play().catch(() => {})
					// Use the original clip as the clock, including any browser buffering.
					if (!audio.paused && Math.abs(at - cue.start - audio.currentTime * 1000) > 200) position.current = cue.start + audio.currentTime * 1000
				}
			} else if (index === -1 && activeCue.current !== -1) { audio?.pause(); stopSpeaking(); activeCue.current = -1 }
			seeking.current = false
			if (at >= lesson.duration) { setPlaying(false); return }
			frame = requestAnimationFrame(tick)
		}
		frame = requestAnimationFrame(tick)
		return () => cancelAnimationFrame(frame)
	}, [playing, lesson, rate, render])

	const togglePlay = () => {
		if (lesson && time >= lesson.duration) seek(0)
		seeking.current = true
		setPlaying((p) => !p)
	}
	const cue = lesson?.cues.find((cue) => time >= cue.start && time < cue.end)
	return <section className="loci-player" aria-label="Explanation replay" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()} onKeyDown={(e) => {
		if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
		if ((e.target as HTMLElement).matches('input, select, button')) return
		if (e.code === 'Space') { e.preventDefault(); togglePlay() }
		if (e.code === 'ArrowLeft') { e.preventDefault(); seek(position.current - 10000) }
		if (e.code === 'ArrowRight') { e.preventDefault(); seek(position.current + 10000) }
	}}>
		{lesson && createPortal(<div className="loci-replay-canvas" aria-label="Replaying explanation on the board"><style>{lesson.writing?.map((w) => { const clip = writingClip(w, time); return clip ? `.loci-replay-canvas .tl-shape[data-shape-id="${CSS.escape(w.shapeId)}"] { clip-path: ${clip}; }` : '' }).join('\n')}</style><Tldraw shapeUtils={shapeUtils} assetUrls={assetUrls} snapshot={lesson.baseline} hideUi licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY || undefined} onMount={(editor) => { editorRef.current = editor; editor.updateInstanceState({ isReadonly: true }); editor.user.updateUserPreferences({ colorScheme: 'light' }); const state = lessonAt(lesson, position.current); editor.loadSnapshot(state.snapshot); editor.setCamera(state.camera) }} /></div>, liveEditor.getContainer())}
		<header><span title={question}>Replay · {question}</span><button className="loci-icon-btn loci-icon-btn--sm" onClick={onClose} aria-label="Finish replay" title="Return to your board"><CloseIcon /></button></header>
		{error && <p className="loci-player__error" role="alert">{error}</p>}
		{lesson ? <>
			{transcript && <aside className="loci-player__transcript" aria-label="Clickable transcript">
				{lesson.cues.map((cue, index) => <button key={index} data-active={time >= cue.start && time < cue.end} onClick={() => seek(cue.start)}><time>{clock(cue.start)}</time><span dangerouslySetInnerHTML={{ __html: renderRich(cue.text) }} /></button>)}
				{!lesson.cues.length && <p>This explanation has drawing only.</p>}
			</aside>}
			{!transcript && cue && <p className="loci-player__caption" dangerouslySetInnerHTML={{ __html: renderRich(cue.text) }} />}
			<div className="loci-player__controls">
				<input aria-label="Explanation timeline" type="range" min="0" max={lesson.duration} step="100" value={time} onChange={(e) => seek(Number(e.target.value))} />
				<div><button onClick={() => seek(position.current - 10000)} aria-label="Rewind 10 seconds">↶ 10s</button><button className="loci-player__play" onClick={togglePlay} aria-label={playing ? 'Pause replay' : 'Play replay'}>{playing ? 'Ⅱ' : '▶'}</button><button onClick={() => seek(position.current + 10000)} aria-label="Forward 10 seconds">10s ↷</button><span>{clock(time)} / {clock(lesson.duration)}</span><select aria-label="Playback speed" value={rate} onChange={(e) => { seeking.current = true; setRate(Number(e.target.value)) }}>{[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => <option key={r} value={r}>{r}×</option>)}</select><button aria-pressed={transcript} onClick={() => setTranscript(!transcript)}>Transcript</button></div>
			</div>
		</> : !error && <p>Opening the saved explanation…</p>}
		<audio ref={audioRef} preload="auto" />
	</section>
}
