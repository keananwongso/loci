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
import { Buddy } from './ui/Buddy'
import { Toolbar } from './ui/Toolbar'
import { PromptBar } from './ui/PromptBar'
import { ResponsePanel } from './ui/ResponsePanel'
import { EmptyState } from './ui/EmptyState'
import { TopBar } from './ui/TopBar'
import { StylePanel } from './ui/StylePanel'
import { HoldToTalk } from './ui/HoldToTalk'
import { KeyDialog } from './ui/KeyDialog'
import { Suggestions } from './ui/Suggestions'
import { useTutor } from './useTutor'
import { ACCEPTED_TYPES, ingestFiles } from '@/lib/canvas/ingest'
import { REGION } from '@/lib/canvas/shape-types'
import { checkSpeechProvider } from '@/lib/voice/player'
import { warmAcks } from '@/lib/voice/ack'
import { loadHandFont } from '@/lib/canvas/hand'
import { installDragToPan } from '@/lib/canvas/pan'

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
	InFrontOfTheCanvas: Buddy,
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
	const [keyDialog, setKeyDialog] = useState(false)

	useEffect(() => {
		const open = () => setKeyDialog(true)
		window.addEventListener('loci:open-key-dialog', open)
		return () => window.removeEventListener('loci:open-key-dialog', open)
	}, [])
	const fileRef = useRef<HTMLInputElement>(null)
	const tutor = useTutor(editor, voiceOut)

	useEffect(() => {
		try {
			setVoiceOut(localStorage.getItem(VOICE_KEY) === '1')
		} catch {}
	}, [])

	// Which voice answers (Fish Audio or the browser's), checked whenever voice is turned on.
	const [voiceProvider, setVoiceProvider] = useState<'fish' | 'browser' | null>(null)
	useEffect(() => {
		if (voiceOut)
			checkSpeechProvider().then((p) => {
				setVoiceProvider(p)
				warmAcks()
			})
	}, [voiceOut])

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
		editor.setCamera({ x: 0, y: 0, z: 1 })
		await tutor.reset()
	}, [editor, tutor])

	// Open localhost:3000/?reset to always start from an empty board.
	const resetOnLoad = useRef(true)
	useEffect(() => {
		if (!resetOnLoad.current) return
		resetOnLoad.current = false
		const url = new URL(window.location.href)
		if (!url.searchParams.has('reset')) return
		url.searchParams.delete('reset')
		window.history.replaceState(null, '', url)
		clearBoard()
	}, [clearBoard])

	const disabledReason = tutor.status.checked && !tutor.status.configured ? 'Connect a model to ask questions' : undefined

	return (
		<div className="loci-ui">
			<TopBar
				status={tutor.status}
				voiceOut={voiceOut}
				voiceProvider={voiceProvider}
				onToggleVoice={toggleVoice}
				onClear={clearBoard}
				onSample={loadSample}
			/>
			<Toolbar onUpload={() => fileRef.current?.click()} />
			<HoldToTalk busy={tutor.busy} onAsk={tutor.ask} onStop={tutor.stop} disabled={Boolean(disabledReason)} voice={voiceOut} />
			<EmptyState onUpload={() => fileRef.current?.click()} onSample={loadSample} loading={loading} />
			{loading && <div className="loci-toast">{loading}</div>}
			<div className="loci-dock">
				<ResponsePanel turns={tutor.turns} busy={tutor.busy} status={tutor.status} onUndo={tutor.undoLastTurn} voice={voiceOut} />
				<Suggestions turns={tutor.turns} busy={tutor.busy} hosted={Boolean(tutor.status.hosted)} onAsk={tutor.ask} />
				<PromptBar
					busy={tutor.busy}
					onAsk={(q) => tutor.ask(q)}
					onStop={tutor.stop}
					disabledReason={disabledReason}
					freeLeft={tutor.status.hosted && !tutor.userKey ? tutor.status.quota?.remaining : undefined}
				/>
			</div>
			{keyDialog && <KeyDialog onClose={() => setKeyDialog(false)} />}
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
		// The canvas sits on eggshell paper and selects in ink rather than tldraw's blue.
		const theme = editor.getTheme('default')
		if (theme) {
			const light = theme.colors.light
			editor.updateTheme({
				...theme,
				colors: {
					...theme.colors,
					light: { ...light, background: '#fdfcfc', negativeSpace: '#fdfcfc', selectionStroke: '#000000', selectionFill: 'rgba(0, 0, 0, 0.04)' },
				},
			})
		}
		loadHandFont(assetUrls.fonts?.tldraw_draw)
		installDragToPan(editor)
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
				// Needed only when deploying on a public domain; localhost works without one.
				licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY || undefined}
				onMount={onMount}
			>
				<Shell />
			</Tldraw>
		</div>
	)
}
