'use client'
import { useEffect, useRef, useState } from 'react'
import { useEditor, useValue } from 'tldraw'
import { describeSelection } from '../selection'
import { canRecognize, startListening } from '@/lib/voice/speech'
import { startMic, stopMic } from '@/lib/voice/level'
import { heard, setTutorMode, talkKeysLabel } from '@/lib/canvas/presence'
import { LayersIcon, MicIcon, PageIcon, SendIcon, StopIcon } from './icons'

interface Props {
	busy: boolean
	onAsk: (question: string, opts?: { spoken: true }) => void
	onStop: () => void
	disabledReason?: string
	/** Hosted demo: free questions left today on this device. */
	freeLeft?: number
}

export function PromptBar({ busy, onAsk, onStop, disabledReason, freeLeft }: Props) {
	const editor = useEditor()
	const [text, setText] = useState('')
	const [listening, setListening] = useState(false)
	const [voiceError, setVoiceError] = useState<string>()
	const inputRef = useRef<HTMLTextAreaElement>(null)
	const stopListening = useRef<(() => Promise<string>) | null>(null)
	const context = useValue('selection-label', () => describeSelection(editor), [editor])
	const hasSelection = context !== 'Current view'

	useEffect(() => {
		const focus = () => inputRef.current?.focus()
		const prefill = (event: Event) => { setText(String((event as CustomEvent).detail)); focus() }
		const onKey = (e: KeyboardEvent) => {
			const el = document.activeElement
			const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement)?.isContentEditable
			if (e.key === '/' && !typing && !editor.getEditingShapeId()) {
				e.preventDefault()
				focus()
			}
		}
		window.addEventListener('loci:focus-prompt', focus)
		window.addEventListener('loci:prefill-prompt', prefill)
		window.addEventListener('keydown', onKey)
		return () => {
			window.removeEventListener('loci:focus-prompt', focus)
			window.removeEventListener('loci:prefill-prompt', prefill)
			window.removeEventListener('keydown', onKey)
		}
	}, [editor])

	useEffect(() => {
		const el = inputRef.current
		if (!el) return
		el.style.height = 'auto'
		el.style.height = `${Math.min(el.scrollHeight, 160)}px`
	}, [text])

	const submit = (value = text, opts?: { spoken: true }) => {
		if (!value.trim() || busy || disabledReason) return
		onAsk(value, opts)
		setText('')
	}

	const beginVoice = () => {
		if (busy || listening) return
		setVoiceError(undefined)
		setListening(true)
		heard.set('')
		setTutorMode('listening')
		startMic()
		stopListening.current = startListening((words) => { setText(words); heard.set(words) }, (msg) => {
			setVoiceError(msg)
			setListening(false)
		})
	}
	const endVoice = async () => {
		if (!stopListening.current) return
		const stop = stopListening.current
		stopListening.current = null
		setTutorMode('transcribing')
		const transcript = await stop()
		stopMic()
		setListening(false)
		heard.set(transcript)
		if (transcript) submit(transcript, { spoken: true })
		else { heard.set(''); setTutorMode('idle') }
	}

	const placeholder = disabledReason
		? disabledReason
		: hasSelection
			? 'Ask about your selection…'
			: `Hold ${talkKeysLabel()} and talk, or type here…`

	return (
		<div className="loci-prompt" onPointerDown={(e) => e.stopPropagation()} data-listening={listening}>
			<div className="loci-prompt__context" data-active={hasSelection} title="What Loci will look at">
				{hasSelection ? <PageIcon /> : <LayersIcon />}
				<span>{context}</span>
			</div>
			<textarea
				ref={inputRef}
				className="loci-prompt__input"
				rows={1}
				value={text}
				placeholder={listening ? 'Listening… release to send' : placeholder}
				disabled={Boolean(disabledReason)}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					e.stopPropagation()
					if (e.key === 'Enter' && !e.shiftKey) {
						e.preventDefault()
						submit()
					}
					if (e.key === 'Escape') inputRef.current?.blur()
				}}
			/>
			{voiceError && <div className="loci-prompt__error">{voiceError}</div>}
			{freeLeft !== undefined && (
				<div className="loci-prompt__quota" data-empty={freeLeft === 0}>
					{freeLeft === 0 ? 'No free questions left today' : `${freeLeft} free question${freeLeft === 1 ? '' : 's'} left today`}
				</div>
			)}
			{canRecognize() && (
				<button
					className="loci-icon-btn"
					data-active={listening}
					title="Hold to talk"
					aria-label="Hold to talk"
					onPointerDown={beginVoice}
					onPointerUp={endVoice}
					onPointerLeave={() => listening && endVoice()}
					disabled={busy || Boolean(disabledReason)}
				>
					<MicIcon />
				</button>
			)}
			{busy ? (
				<button className="loci-send loci-send--stop" onClick={onStop} title="Stop" aria-label="Stop">
					<StopIcon />
				</button>
			) : (
				<button className="loci-send" onClick={() => submit()} disabled={!text.trim() || Boolean(disabledReason)} title="Ask (Enter)" aria-label="Ask">
					<SendIcon />
				</button>
			)}
		</div>
	)
}
