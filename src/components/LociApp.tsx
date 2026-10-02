'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
	Tldraw,
	useEditor,
	type Editor,
	type TLComponents,
	type TLUiOverrides,
} from 'tldraw'
import { getAssetUrlsByMetaUrl } from '@tldraw/assets/urls'
import { MaterialShapeUtil } from './shapes/MaterialShapeUtil'
import { EquationShapeUtil } from './shapes/EquationShapeUtil'
import { GraphShapeUtil } from './shapes/GraphShapeUtil'
import { HighlightShapeUtil } from './shapes/HighlightShapeUtil'
import { RegionShapeUtil, RegionTool } from './shapes/RegionShapeUtil'
import { TutorCursor } from './ui/TutorCursor'
import { Toolbar } from './ui/Toolbar'
import { PromptBar } from './ui/PromptBar'
import { ResponsePanel } from './ui/ResponsePanel'
import { EmptyState } from './ui/EmptyState'
import { TopBar } from './ui/TopBar'
import { StylePanel } from './ui/StylePanel'
import { useTutor } from './useTutor'
import { ACCEPTED_TYPES, ingestFiles } from '@/lib/canvas/ingest'
import { REGION } from '@/lib/canvas/shape-types'

const shapeUtils = [MaterialShapeUtil, EquationShapeUtil, GraphShapeUtil, HighlightShapeUtil, RegionShapeUtil]
const tools = [RegionTool]

// Self-hosted fonts and icons: the app makes no requests to third-party CDNs.
const assetUrls = getAssetUrlsByMetaUrl()

const components: TLComponents = {
	MainMenu: null,
	PageMenu: null,
	ActionsMenu: null,
	HelpMenu: null,
	Toolbar: null,
	QuickActions: null,
	SharePanel: null,
	MenuPanel: null,
	TopPanel: null,
	DebugPanel: null,
	DebugMenu: null,
	HelperButtons: null,
	Minimap: null,
	InFrontOfTheCanvas: TutorCursor,
	StylePanel,
}

const overrides: TLUiOverrides = {
	tools(editor, toolItems) {
		toolItems['loci-region'] = {
			id: 'loci-region',
			label: 'Ask about an area' as never,
			icon: 'tool-frame',
			kbd: 'q',
			onSelect: () => editor.setCurrentTool('loci-region'),
		}
		return toolItems
	},
}

const VOICE_KEY = 'loci:voice-out'

function Shell() {
	const editor = useEditor()
	const [voiceOut, setVoiceOut] = useState(false)
	const [loading, setLoading] = useState<string | null>(null)
	const fileRef = useRef<HTMLInputElement>(null)
	const tutor = useTutor(editor, voiceOut)

	useEffect(() => {
		try {
			setVoiceOut(localStorage.getItem(VOICE_KEY) === '1')
		} catch {}
	}, [])

	const toggleVoice = () => {
		setVoiceOut((v) => {
			try {
				localStorage.setItem(VOICE_KEY, v ? '0' : '1')
			} catch {}
			return !v
		})
	}

	const ingest = useCallback((files: File[]) => ingestFiles(editor, files, setLoading), [editor])

	// Dropped or pasted pdfs and images become material pages instead of plain images.
	useEffect(() => {
		editor.registerExternalContentHandler('files', async (info) => {
			const ours = info.files.filter((f) => ACCEPTED_TYPES.includes(f.type) || f.name.toLowerCase().endsWith('.pdf'))
			if (ours.length) await ingest(ours)
			else {
				setLoading('Loci accepts pdf, png and jpg files.')
				setTimeout(() => setLoading(null), 2500)
			}
		})
	}, [editor, ingest])

	// A region is a pointing gesture: once it is no longer selected, it disappears.
	useEffect(() => {
		return editor.store.listen(
			() => {
				const selected = new Set(editor.getSelectedShapeIds())
				const stale = editor
					.getCurrentPageShapes()
					.filter((s) => s.type === REGION && !selected.has(s.id))
					.map((s) => s.id)
				if (stale.length && editor.getCurrentToolId() !== 'loci-region' && !tutor.busy) {
					editor.timers.setTimeout(() => editor.deleteShapes(stale), 0)
				}
			},
			{ scope: 'session', source: 'user' }
		)
	}, [editor, tutor.busy])

	const loadSample = useCallback(async () => {
		setLoading('Loading sample notes…')
		const res = await fetch('/samples/directional-derivatives.pdf')
		const blob = await res.blob()
		await ingest([new File([blob], 'directional-derivatives.pdf', { type: 'application/pdf' })])
	}, [ingest])

	const clearBoard = useCallback(async () => {
		editor.deleteShapes([...editor.getCurrentPageShapeIds()])
		editor.clearHistory()
		await tutor.reset()
	}, [editor, tutor])

	const disabledReason = tutor.status.checked && !tutor.status.configured ? 'Connect a model to ask questions' : undefined

	return (
		<div className="loci-ui">
			<TopBar status={tutor.status} voiceOut={voiceOut} onToggleVoice={toggleVoice} onClear={clearBoard} onSample={loadSample} />
			<Toolbar onUpload={() => fileRef.current?.click()} />
			<EmptyState onUpload={() => fileRef.current?.click()} onSample={loadSample} loading={loading} />
			{loading && <div className="loci-toast">{loading}</div>}
			<div className="loci-dock">
				<ResponsePanel turns={tutor.turns} busy={tutor.busy} status={tutor.status} onUndo={tutor.undoLastTurn} />
				<PromptBar busy={tutor.busy} onAsk={tutor.ask} onStop={tutor.stop} disabledReason={disabledReason} />
			</div>
			<input
				ref={fileRef}
				type="file"
				accept=".pdf,image/png,image/jpeg,image/webp"
				multiple
				hidden
				onChange={(e) => {
					const files = Array.from(e.currentTarget.files ?? [])
					e.currentTarget.value = ''
					if (files.length) ingest(files)
				}}
			/>
		</div>
	)
}

export default function LociApp() {
	const onMount = useCallback((editor: Editor) => {
		editor.user.updateUserPreferences({ colorScheme: 'light' })
	}, [])

	return (
		<div className="loci-root">
			<Tldraw
				persistenceKey="loci-board"
				shapeUtils={shapeUtils}
				tools={tools}
				components={components}
				overrides={overrides}
				assetUrls={assetUrls}
				onMount={onMount}
			>
				<Shell />
			</Tldraw>
		</div>
	)
}
