'use client'
import { useEffect, useRef, useState } from 'react'

export function OwnProblem({ onClose, onAdd, onUpload }: { onClose: () => void; onAdd: (text: string) => void; onUpload: () => void }) {
	const [text, setText] = useState('')
	const ref = useRef<HTMLDialogElement>(null)
	useEffect(() => {
		ref.current?.showModal()
	}, [])
	return (
		<dialog
			className="loci-entry" aria-labelledby="loci-own-title"
			ref={ref}
			onCancel={onClose}
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose()
			}}
		>
			<h2 id="loci-own-title">Bring your own problem.</h2>
			<p>
				Paste a question or screenshot below to place it on the whiteboard. You can also upload an image or PDF.
			</p>
			<form
				onSubmit={(e) => {
					e.preventDefault()
					if (text.trim()) onAdd(text.trim())
				}}
			>
				<textarea
					className="loci-own-problem"
					autoFocus
					aria-label="Your problem"
					maxLength={4000}
					placeholder="Paste your question or screenshot…"
					value={text}
					onChange={(e) => setText(e.target.value)}
				/>
				<p className="loci-landing__fine">Questions use the same daily allowance. Selected material is sent to the tutor’s model provider.</p>
				<div className="loci-landing__actions">
					<button className="loci-primary" disabled={!text.trim()} type="submit">
						Add to whiteboard
					</button>
					<button className="loci-secondary" type="button" onClick={onUpload}>
						Upload a file
					</button>
					<button className="loci-coach__skip" type="button" onClick={onClose}>
						Back
					</button>
				</div>
			</form>
		</dialog>
	)
}
