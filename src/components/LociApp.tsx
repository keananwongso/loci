'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Tldraw, useEditor, useValue, type Editor, type TLComponents, type TLUiOverrides, toRichText, createShapeId } from 'tldraw'
import { getAssetUrlsByMetaUrl } from '@tldraw/assets/urls'
import { MaterialShapeUtil } from './shapes/MaterialShapeUtil'
import { EquationShapeUtil } from './shapes/EquationShapeUtil'
import { GraphShapeUtil } from './shapes/GraphShapeUtil'
import { HighlightShapeUtil } from './shapes/HighlightShapeUtil'
import { RegionShapeUtil, RegionTool } from './shapes/RegionShapeUtil'
import { Buddy } from './ui/Buddy'
import { Emphasis } from './ui/Emphasis'
import { Toolbar } from './ui/Toolbar'
import { PromptBar } from './ui/PromptBar'
import { ResponsePanel } from './ui/ResponsePanel'
import { EmptyState } from './ui/EmptyState'
import { TopBar } from './ui/TopBar'
import { StylePanel } from './ui/StylePanel'
import { HoldToTalk } from './ui/HoldToTalk'
import { KeyDialog } from './ui/KeyDialog'
import { OwnProblem } from './ui/OwnProblem'
import { TourCoach, TourEnd, TourRecord, TourStart } from './ui/Tour'
import { useTutor } from './useTutor'
import { useTour } from './useTour'
import { ACCEPTED_TYPES, ingestFiles } from '@/lib/canvas/ingest'
import { tutorPresence } from '@/lib/canvas/presence'
import { REGION } from '@/lib/canvas/shape-types'
import { checkSpeechProvider } from '@/lib/voice/player'
import { warmAcks } from '@/lib/voice/ack'
import { loadHandFont } from '@/lib/canvas/hand'
import { installDragToPan } from '@/lib/canvas/pan'
import { loadPack, loadPackVoice, placePack } from '@/lib/demo/client'

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
	InFrontOfTheCanvas: () => (
		<>
			<Emphasis />
			<Buddy />
		</>
	),
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
	const [ownNotes, setOwnNotes] = useState(false)
	const voiceMode = useValue('tour-voice-mode', () => tutorPresence.get().mode, [])

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
		// The demo's pre-rendered clips (acknowledgements included) load first, so they aren't synthesized.
		if (voiceOut)
			Promise.all([checkSpeechProvider(), loadPackVoice()]).then(([p]) => {
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

	// The hosted demo only teaches from its own notes: no uploads, a pointer to the repo instead.
	const hosted = Boolean(tutor.status.hosted)

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
			{ scope: 'session', source: 'user' },
		)
	}, [editor, tutor.busy])

	const loadSample = useCallback(async () => {
		setLoading('Loading sample notes…')
		const pack = await loadPack()
		if (pack) await placePack(editor, pack, setLoading)
		setLoading(null)
	}, [editor])

	const clearBoard = useCallback(async () => {
		editor.deleteShapes([...editor.getCurrentPageShapeIds()])
		editor.clearHistory()
		editor.setCamera({ x: 0, y: 0, z: 1 })
		await tutor.reset()
	}, [editor, tutor])

	// Open localhost:3000/demo?reset to always start from an empty board.
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

	// The local admin's record mode: the tour, asking the live model, with a keep button per answer.
	const [record] = useState(
		() => process.env.NODE_ENV === 'development' && typeof window !== 'undefined' && new URL(window.location.href).searchParams.has('record'),
	)
	const tour = useTour({
		editor,
		ask: tutor.ask,
		busy: tutor.busy,
		clear: clearBoard,
		setVoiceOut: (on) => {
			setVoiceOut(on)
			try {
				localStorage.setItem(VOICE_KEY, on ? '1' : '0')
			} catch {}
		},
		setLoading,
		record,
	})
	const ask = tour.ask

	// First visit to the hosted demo, or record mode: start with the lesson. A returning visitor
	// gets the demo board back if theirs is empty.
	const opened = useRef(false)
	useEffect(() => {
		if (opened.current || !tour.pack || !tutor.status.checked) return
		opened.current = true
		const lesson = new URL(window.location.href).searchParams.has('lesson')
		if (record) tour.open()
		else if (lesson) void tour.begin().catch(() => setLoading('Could not load the demo. Refresh to try again.'))
		else if (tutor.status.hosted && editor.getCurrentPageShapeIds().size === 0) loadSample()
	}, [tour, tutor.status, record, editor, loadSample])

	const startTour = useCallback(() => {
		if (editor.getCurrentPageShapeIds().size > 0 && !confirm('The lesson starts on a fresh board. Clear this one?')) return
		tour.open()
	}, [editor, tour])

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
				onTour={tour.pack?.steps.length ? startTour : undefined}
				onEraseDrawings={() => {
					if (tutor.busy) tutor.stop()
					const n = tutor.eraseDrawings()
					setLoading(
						n
							? `Erased ${n} drawing${n === 1 ? '' : 's'}. Press ${/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl'} + Z to bring them back.`
							: 'Nothing drawn by Loci to erase.',
					)
					setTimeout(() => setLoading(null), 2800)
				}}
			/>
			<Toolbar onUpload={() => fileRef.current?.click()} />
			<HoldToTalk busy={tutor.busy} onAsk={ask} onStop={tutor.stop} disabled={Boolean(disabledReason)} voice={voiceOut} />
			{tour.phase === 'start' ? (
				<TourStart tour={tour} overBoard={editor.getCurrentPageShapeIds().size > 0} />
			) : tour.phase === 'running' ? null : (
				<EmptyState onUpload={() => fileRef.current?.click()} onSample={tour.pack?.steps.length ? startTour : loadSample} loading={loading} />
			)}
			{loading && <div className="loci-toast">{loading}</div>}
			{record ? (
				<TourRecord tour={tour} busy={tutor.busy} model={tutor.status.model} onRedo={tutor.undoLastTurn} />
			) : (
				<TourCoach tour={tour} busy={tutor.busy} listening={voiceMode === 'listening'} sending={voiceMode === 'thinking'} />
			)}
			<TourEnd
				tour={tour}
				busy={tutor.busy}
				onOwnProblem={() => setOwnNotes(true)}
				freeLeft={tutor.status.hosted && !tutor.userKey ? tutor.status.quota?.remaining : undefined}
			/>
			<div className="loci-dock">
				<ResponsePanel turns={tutor.turns} busy={tutor.busy} status={tutor.status} onUndo={tutor.undoLastTurn} voice={voiceOut} />
				<PromptBar
					busy={tutor.busy}
					onAsk={(q) => ask(q)}
					onStop={tutor.stop}
					disabledReason={disabledReason}
					freeLeft={tutor.status.hosted && !tutor.userKey ? tutor.status.quota?.remaining : undefined}
				/>
			</div>
			{keyDialog && <KeyDialog onClose={() => setKeyDialog(false)} />}
			{ownNotes && (
				<OwnProblem
					onClose={() => setOwnNotes(false)}
					onUpload={() => {
						setOwnNotes(false)
						fileRef.current?.click()
					}}
					onAdd={(text) => {
						const center = editor.getViewportPageBounds().center
						const id = createShapeId()
						editor.createShape({ id, type: 'text', x: center.x, y: center.y, props: { richText: toRichText(text), autoSize: false, w: 420 } })
						editor.select(id)
						editor.zoomToBounds(editor.getSelectionPageBounds()!, { inset: 100 })
						setOwnNotes(false)
						requestAnimationFrame(() => window.dispatchEvent(new Event('loci:focus-prompt')))
					}}
				/>
			)}
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
