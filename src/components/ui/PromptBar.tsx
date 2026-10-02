'use client'
import { useEffect, useRef, useState } from 'react'
import { useEditor, useValue } from 'tldraw'
import { describeSelection } from '../selection'
import { canRecognize, startListening } from '@/lib/voice/speech'
import { orbListen, orbStopListening } from '@/lib/voice/orb'
import { LayersIcon, MicIcon, PageIcon, SendIcon, StopIcon } from './icons'

interface Props {
	busy: boolean
	onAsk: (question: string) => void
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
		const onKey = (e: KeyboardEvent) => {
			const el = document.activeElement
			const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement)?.isContentEditable
			if (e.key === '/' && !typing && !editor.getEditingShapeId()) {
				e.preventDefault()
				focus()
			}
		}
		window.addEventListener('loci:focus-prompt', focus)
		window.addEventListener('keydown', onKey)
		return () => {
			window.removeEventListener('loci:focus-prompt', focus)
			window.removeEventListener('keydown', onKey)
		}
	}, [editor])

	useEffect(() => {
		const el = inputRef.current
		if (!el) return
		el.style.height = 'auto'
		el.style.height = `${Math.min(el.scrollHeight, 160)}px`
	}, [text])

	const submit = (value = text) => {
		if (!value.trim() || busy || disabledReason) return
		onAsk(value)
		setText('')
	}

	const beginVoice = () => {
		if (busy || listening) return
		setVoiceError(undefined)
		setListening(true)
		orbListen()
		stopListening.current = startListening(setText, (msg) => {
			setVoiceError(msg)
			setListening(false)
		})
	}
	const endVoice = async () => {
		if (!stopListening.current) return
		const transcript = await stopListening.current()
		orbStopListening()
		stopListening.current = null
		setListening(false)
		if (transcript) submit(transcript)
	}

	const placeholder = disabledReason
		? disabledReason
		: hasSelection
			? 'Ask about your selection…'
			: 'Select something on the board, or just ask…'

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
