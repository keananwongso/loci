'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Tldraw, useEditor, useValue, type Editor, type TLComponents, type TLUiOverrides, toRichText, createShapeId } from 'tldraw'
import { RegionTool } from './shapes/RegionShapeUtil'
import { Buddy } from './ui/Buddy'
import { Emphasis } from './ui/Emphasis'
import { Toolbar } from './ui/Toolbar'
import { PromptBar } from './ui/PromptBar'
import { LessonPlayer } from './ui/LessonPlayer'
import type { Turn } from '@/lib/storage/conversation'
import { ResponsePanel } from './ui/ResponsePanel'
import { EmptyState } from './ui/EmptyState'
import { TopBar } from './ui/TopBar'
import { StylePanel } from './ui/StylePanel'
import { HoldToTalk } from './ui/HoldToTalk'
import { KeyDialog } from './ui/KeyDialog'
import { OwnProblem } from './ui/OwnProblem'
import { TourCoach, TourEnd, TourRecord, TourStart } from './ui/Tour'
import { useTutor } from './useTutor'
import { useTour, tourDone } from './useTour'
import { canvasKey, readWorkspaces, writeWorkspaces, shouldStartLesson, type WorkspaceLibrary } from '@/lib/storage/workspaces'
import { BoardLibrary } from './ui/BoardLibrary'
import { ACCEPTED_TYPES, ingestFiles } from '@/lib/canvas/ingest'
import { tutorPresence } from '@/lib/canvas/presence'
import { REGION } from '@/lib/canvas/shape-types'
import { checkSpeechProvider } from '@/lib/voice/player'
import { warmAcks } from '@/lib/voice/ack'
import { loadHandFont } from '@/lib/canvas/hand'
import { installDragToPan } from '@/lib/canvas/pan'
import { loadPack, loadPackVoice, placePack } from '@/lib/demo/client'

import { shapeUtils, assetUrls } from './canvasConfig'
const tools = [RegionTool]

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

function Shell({ library, onLibrary }: { library: WorkspaceLibrary; onLibrary: (library: WorkspaceLibrary) => void }) {
	const editor = useEditor()
	const [voiceOut, setVoiceOut] = useState(false)
	const [loading, setLoading] = useState<string | null>(null)
	const [keyDialog, setKeyDialog] = useState(false)
	const [replay, setReplay] = useState<Turn | null>(null)
	const [ownNotes, setOwnNotes] = useState(false)
	const voiceMode = useValue('tour-voice-mode', () => tutorPresence.get().mode, [])

	useEffect(() => {
		const open = () => setKeyDialog(true)
		window.addEventListener('loci:open-key-dialog', open)
		return () => window.removeEventListener('loci:open-key-dialog', open)
	}, [])
	const fileRef = useRef<HTMLInputElement>(null)
	const tutor = useTutor(editor, voiceOut, library.active)

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

	// Hosted visitors share the daily demo allowance.
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
	const ask = async (question: string, opts?: Parameters<typeof tour.ask>[1]) => {
		if (replay) { setReplay(null); await new Promise(requestAnimationFrame) }
		return tour.ask(question, opts)
	}

	// First visit to the hosted demo, or record mode: start with the lesson. A returning visitor
	// gets the demo board back if theirs is empty.
	const opened = useRef(false)
	useEffect(() => {
		if (opened.current || !tour.pack || !tutor.status.checked || !tutor.ready) return
		opened.current = true
		const params = new URL(window.location.href).searchParams
		const lesson = params.has('lesson')
		const replay = params.has('replay')
		if (record) tour.open()
		else if (replay || shouldStartLesson(lesson, tourDone(), editor.getCurrentPageShapeIds().size > 0 || tutor.turns.length > 0)) void tour.begin().catch(() => setLoading('Could not load the demo. Refresh to try again.'))
		// Existing material always wins over a first-run link.
		const url = new URL(window.location.href)
		if (lesson || replay) { url.searchParams.delete('lesson'); url.searchParams.delete('replay'); window.history.replaceState(null, '', url) }
	}, [tour, tutor.status, tutor.ready, tutor.turns.length, record, editor, loadSample])

	const startTour = () => {
		const id = crypto.randomUUID()
		const url = new URL(window.location.href)
		url.searchParams.set('replay', '1')
		window.history.replaceState(null, '', url)
		onLibrary({ active: id, boards: [...library.boards, { id, name: 'Demo lesson', updatedAt: Date.now() }] })
	}

	const newBoard = () => {
		const id = crypto.randomUUID()
		onLibrary({ active: id, boards: [...library.boards, { id, name: `Board ${library.boards.length + 1}`, updatedAt: Date.now() }] })
	}

	const disabledReason = tutor.status.checked && !tutor.status.configured ? 'Connect a model to ask questions' : undefined

	return (
		<div
			className="loci-ui"
			data-replay={Boolean(replay)}
			onPasteCapture={(e) => {
				if (replay && e.clipboardData.files.length) { e.preventDefault(); e.stopPropagation(); return }
				// Editable fields bypass tldraw's canvas paste handler. Accept files there too.
				if (!ownNotes && !(e.target instanceof Element && e.target.closest('.loci-prompt'))) return
				const clipboardFiles = Array.from(e.clipboardData.files)
				const files = (clipboardFiles.length ? clipboardFiles : Array.from(e.clipboardData.items).flatMap((item) => {
					const file = item.kind === 'file' ? item.getAsFile() : null
					return file ? [file] : []
				})).filter((file) => ACCEPTED_TYPES.includes(file.type) || file.name.toLowerCase().endsWith('.pdf'))
				if (!files.length) return // Let ordinary text paste into the field.
				e.preventDefault()
				e.stopPropagation()
				void ingest(files).then((ids) => {
					if (!ids.length) return
					setOwnNotes(false)
					requestAnimationFrame(() => window.dispatchEvent(new Event('loci:focus-voice')))
				})
			}}
		>
			<TopBar
				status={tutor.status}
				voiceOut={voiceOut}
				voiceProvider={voiceProvider}
				onToggleVoice={toggleVoice}
				onClear={newBoard}
				busy={tutor.busy || Boolean(loading) || tour.speaking || Boolean(replay)}
				library={<BoardLibrary library={library} disabled={tutor.busy || Boolean(loading) || tour.speaking || Boolean(replay)} onSelect={(active) => onLibrary({ ...library, active })} onNew={newBoard} onRename={(name) => onLibrary({ ...library, boards: library.boards.map((b) => b.id === library.active ? { ...b, name } : b) })} />}
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
			{!replay && <Toolbar onUpload={() => fileRef.current?.click()} />}
			{!replay && <HoldToTalk busy={tutor.busy} onAsk={ask} onStop={tutor.stop} disabled={Boolean(disabledReason)} voice={voiceOut} />}
			{!replay && (tour.phase === 'start' ? (
				<TourStart tour={tour} overBoard={editor.getCurrentPageShapeIds().size > 0} />
			) : tour.phase === 'running' ? null : (
				<EmptyState onUpload={() => fileRef.current?.click()} onSample={tour.pack?.steps.length ? startTour : loadSample} loading={loading} />
			))}
			{loading && <div className="loci-toast">{loading}</div>}
			{!replay && (record ? (
				<TourRecord tour={tour} busy={tutor.busy} model={tutor.status.model} onRedo={tutor.undoLastTurn} />
			) : (
				<TourCoach tour={tour} busy={tutor.busy} listening={voiceMode === 'listening'} transcribing={voiceMode === 'transcribing'} sending={voiceMode === 'thinking'} />
			))}
			{!replay && <TourEnd
				tour={tour}
				busy={tutor.busy}
				onOwnProblem={() => setOwnNotes(true)}
				freeLeft={tutor.status.hosted && !tutor.status.pro && !tutor.userKey ? tutor.status.quota?.remaining : undefined}
			/>}
			<div className="loci-dock">
				{replay?.lessonId ? <LessonPlayer id={replay.lessonId} question={replay.question} onClose={() => setReplay(null)} /> : <ResponsePanel turns={tutor.turns} busy={tutor.busy} status={tutor.status} onUndo={tutor.undoLastTurn} voice={voiceOut} onReplay={setReplay} />}
				<PromptBar
					busy={tutor.busy}
					onAsk={(q, opts) => ask(q, opts)}
					onStop={tutor.stop}
					disabledReason={disabledReason}
					pro={tutor.status.pro}
					talkDisabled={Boolean(replay)}
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
						requestAnimationFrame(() => window.dispatchEvent(new Event('loci:focus-voice')))
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
	const [library, setLibrary] = useState<WorkspaceLibrary | null>(null)
	const [storageError, setStorageError] = useState(false)
	useEffect(() => { setLibrary(readWorkspaces()) }, [])
	const changeLibrary = (next: WorkspaceLibrary) => {
		try { writeWorkspaces(next); setLibrary(next) } catch { setStorageError(true) }
	}

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

	if (!library) return <div className="loci-loading">Opening your board…</div>
	return (
		<div className="loci-root">
			{storageError && <p className="loci-toast">Browser storage is unavailable. Allow storage to save and switch boards.</p>}
			<Tldraw
				key={library.active}
				persistenceKey={canvasKey(library.active)}
				shapeUtils={shapeUtils}
				tools={tools}
				components={components}
				overrides={overrides}
				assetUrls={assetUrls}
				// Needed only when deploying on a public domain; localhost works without one.
				licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY || undefined}
				onMount={onMount}
			>
				<Shell library={library} onLibrary={changeLibrary} />
			</Tldraw>
		</div>
	)
}
