'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useEditor, useValue } from '@/lib/whiteboard'
import { describeSelection } from '../selection'
import { heard, tutorPresence, talkKeysLabel } from '@/lib/canvas/presence'
import { BookIcon, KeyboardIcon, LayersIcon, MicIcon, PageIcon, SendIcon, StopIcon } from './icons'

interface Props {
	busy: boolean
	topicControl?: ReactNode
	learning?: boolean
	onUploadStudy?: () => void
	onAsk: (question: string, opts?: { spoken: true }) => void
	onStop: () => void
	disabledReason?: string
	freeLeft?: number
	pro?: boolean
	talkDisabled?: boolean
}

const talk = (action: 'start' | 'end') => window.dispatchEvent(new Event(`loci:talk-${action}`))

export function PromptBar({ busy, onAsk, onStop, disabledReason, freeLeft, pro, talkDisabled, topicControl, learning = false, onUploadStudy }: Props) {
	const editor = useEditor()
	const [text, setText] = useState('')
	const [typing, setTyping] = useState(false)
	const [studyOpen, setStudyOpen] = useState(false)
	const [hint, setHint] = useState(false)
	useEffect(() => { try { setHint(!localStorage.getItem('loci:input-hint-seen')) } catch {} }, [])
	const dismissHint = () => { setHint(false); try { localStorage.setItem('loci:input-hint-seen', '1') } catch {} }
	const inputRef = useRef<HTMLTextAreaElement>(null)
	const voiceRef = useRef<HTMLButtonElement>(null)
	const context = useValue('selection-label', () => describeSelection(editor), [editor])
	const mode = useValue('prompt-voice-mode', () => tutorPresence.get().mode, [])
	const transcript = useValue('prompt-transcript', () => heard.get(), [])
	const listening = mode === 'listening'
	const transcribing = mode === 'transcribing'
	const hasSelection = context !== 'Current view'
	const keys = talkKeysLabel()

	useEffect(() => {
		const focus = () => { setTyping(true); inputRef.current?.focus() }
		const prefill = (event: Event) => { setText(String((event as CustomEvent).detail)); focus() }
		const focusVoice = () => { setTyping(false); requestAnimationFrame(() => voiceRef.current?.focus()) }
		const onKey = (e: KeyboardEvent) => {
			const el = document.activeElement
			const inField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement)?.isContentEditable
			if (e.key === '/' && !inField && !editor.getEditingShapeId()) {
				e.preventDefault()
				focus()
			}
		}
		window.addEventListener('loci:focus-prompt', focus)
		window.addEventListener('loci:prefill-prompt', prefill)
		window.addEventListener('loci:focus-voice', focusVoice)
		window.addEventListener('keydown', onKey)
		return () => {
			window.removeEventListener('loci:focus-prompt', focus)
			window.removeEventListener('loci:prefill-prompt', prefill)
			window.removeEventListener('loci:focus-voice', focusVoice)
			window.removeEventListener('keydown', onKey)
		}
	}, [editor])

	useEffect(() => { if (typing) inputRef.current?.focus() }, [typing])
	useEffect(() => { if (listening) setTyping(false) }, [listening])
	useEffect(() => {
		const el = inputRef.current
		if (!el) return
		el.style.height = 'auto'
		el.style.height = `${Math.min(el.scrollHeight, 160)}px`
	}, [text, typing, talkDisabled])

	const submit = () => {
		if (!text.trim() || busy || disabledReason) return
		onAsk(text)
		setText('')
		setTyping(false)
	}

	return (
		<div className="loci-prompt" onPointerDown={(e) => e.stopPropagation()} data-learning={learning} data-listening={listening} data-typing={typing || Boolean(talkDisabled)}>
			{hint && !learning && <div className="loci-input-onboarding" role="tooltip"><span>Hold the mic to ask, type with the keyboard, or add your study materials.</span><button aria-label="Dismiss input tip" onClick={dismissHint}>×</button></div>}
			<div className="loci-prompt__meta">
				<div hidden={!hasSelection} className="loci-prompt__context" data-active={hasSelection} title="What Loci will look at">
					{hasSelection ? <PageIcon /> : <LayersIcon />}
					<span>{context}</span>
				</div>
				{freeLeft === 0 && (
					<span className="loci-prompt__quota" data-empty={freeLeft === 0}>
						No questions left · <a href="/account">View allowance</a>
					</span>
				)}
			</div>
			<div className="loci-prompt__controls">
				{typing || talkDisabled ? (
					<>
						<textarea
							ref={inputRef}
							className="loci-prompt__input"
							aria-label="Your question"
							rows={1}
							value={text}
							placeholder={disabledReason ?? (talkDisabled ? 'Ask a new question…' : hasSelection ? 'Ask about your selection…' : 'Type your question…')}
							disabled={Boolean(disabledReason)}
							onChange={(e) => setText(e.target.value)}
							onKeyDown={(e) => {
								e.stopPropagation()
								if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
								if (e.key === 'Escape') { e.preventDefault(); setTyping(false) }
							}}
						/>
						{!talkDisabled && <button className="loci-prompt__switch" aria-label="Switch to voice" title="Switch to voice" onClick={() => setTyping(false)}><MicIcon /></button>}
						{!busy && <button className="loci-send" onClick={submit} disabled={!text.trim() || Boolean(disabledReason)} title="Ask (Enter)" aria-label="Ask"><SendIcon /></button>}
					</>
				) : (
					<>
						<button
							ref={voiceRef}
							className="loci-prompt__talk"
							aria-label="Hold to talk"
							title="Hold to talk: release to send your question"
							aria-keyshortcuts="Control+Alt Space Enter"
							data-active={listening}
							disabled={Boolean(disabledReason) || transcribing || talkDisabled}
							onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); dismissHint(); e.currentTarget.setPointerCapture(e.pointerId); talk('start') }}
							onPointerUp={() => talk('end')}
							onPointerCancel={() => talk('end')}
							onLostPointerCapture={() => talk('end')}
							onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!e.repeat) talk('start') } }}
							onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); talk('end') } }}
						>
							<MicIcon />
							<span>{listening ? 'Listening…' : transcribing ? 'Transcribing…' : <>Hold <kbd title={keys === '⌃ + ⌥' ? 'Control + Option' : keys}>{keys}</kbd> to talk</>}</span>
						</button>
						<div hidden={!listening && !transcribing && !disabledReason} className="loci-prompt__voice-hint" role="status" aria-live="polite">
							{listening || transcribing ? <><span className="loci-prompt__heard">{transcript || (listening ? 'Ask about your notes' : 'Finishing your question')}</span><small>{listening ? 'Release to send' : 'Sending when ready'}</small></> : <span>{disabledReason ?? (talkDisabled ? 'Type a new question to leave replay' : 'Point at your notes while you talk')}</span>}
						</div>
						<button className="loci-prompt__switch" aria-label="Switch to typing" title="Type a question (/)" disabled={listening || transcribing} onClick={() => { dismissHint(); setTyping(true) }}><KeyboardIcon /></button>
					</>
				)}
                <div className="loci-study-control">
                 <button className="loci-prompt__switch" aria-label="Study materials and lessons" title="Study materials & lessons: add notes, PDF or link, or learn a topic" aria-expanded={studyOpen} onClick={()=>{dismissHint();setStudyOpen(!studyOpen)}}><BookIcon /></button>
                 <div className="loci-study-menu" data-open={studyOpen}><button onClick={()=>{setStudyOpen(false);onUploadStudy?.()}}>Upload notes, PDF or link</button>{topicControl}</div>
                </div>
				{busy && <button className="loci-send loci-send--stop" onClick={onStop} title="Stop" aria-label="Stop"><StopIcon /></button>}
			</div>
		</div>
	)
}
