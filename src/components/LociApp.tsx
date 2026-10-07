'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Whiteboard, useEditor, useValue, toRichText, createShapeId } from '@/lib/whiteboard'
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
import { TopicLesson } from './ui/TopicLesson'
import { ingestLink, ingestArticle } from '@/lib/documents/link'
import { readTopic, lessonContext, sourcePages, sourceFingerprint, saveTopic, teachingCheckpoint } from '@/lib/topics/sources'
import { AddMaterial } from './ui/AddMaterial'
import { TourCoach, TourEnd, TourRecord, TourStart } from './ui/Tour'
import { useTutor } from './useTutor'
import { useTour, tourDone } from './useTour'
import { canvasKey, readWorkspaces, writeWorkspaces, shouldStartLesson, type WorkspaceLibrary } from '@/lib/storage/workspaces'
import { BoardLibrary } from './ui/BoardLibrary'
import { useCloudSync, type SyncState } from './useCloudSync'
import { CloudError, createBoard, createSpace, listBoards, updateBoard } from '@/lib/storage/cloud'
import { ACCEPTED_TYPES, ingestFiles } from '@/lib/canvas/ingest'
import { tutorPresence } from '@/lib/canvas/presence'
import { REGION } from '@/lib/canvas/shape-types'
import { checkSpeechProvider } from '@/lib/voice/player'
import { warmAcks } from '@/lib/voice/ack'
import { loadPack, loadPackVoice, placePack } from '@/lib/demo/client'

import { shapeUtils } from './canvasConfig'
const components = { InFrontOfTheCanvas: () => <><Emphasis /><Buddy /></>, StylePanel }

const VOICE_KEY = 'loci:voice-out'

function Shell({ library, onLibrary, account }: { library: WorkspaceLibrary; onLibrary: (library: WorkspaceLibrary) => void; account?: { pro: boolean; saveState: React.ReactNode } }) {
	const editor = useEditor()
	const [voiceOut, setVoiceOut] = useState(false)
	const [loading, setLoading] = useState<string | null>(null)
	const [keyTab, setKeyTab] = useState<'ai' | 'voice'>('ai')
 const [voiceNotice, setVoiceNotice] = useState('')
	const [keyDialog, setKeyDialog] = useState(false)
	const [replay, setReplay] = useState<Turn | null>(null)
	const [ownNotes, setOwnNotes] = useState(false)
	const [adding, setAdding] = useState<File[] | null>(null)
	const [planning, setPlanning] = useState(false)
	const [requestedTopic, setRequestedTopic] = useState('')
	const [topicRequest, setTopicRequest] = useState(0)
	const [materialAdded, setMaterialAdded] = useState(false)
	const voiceMode = useValue('tour-voice-mode', () => tutorPresence.get().mode, [])

	useEffect(() => {
		const open = () => { setKeyTab('ai'); setKeyDialog(true) }
  const voice = () => { setKeyTab('voice'); setKeyDialog(true) }
		window.addEventListener('loci:open-key-dialog', open)
  window.addEventListener('loci:open-voice-dialog', voice)
		return () => { window.removeEventListener('loci:open-key-dialog', open); window.removeEventListener('loci:open-voice-dialog', voice) }
	}, [])
	const fileRef = useRef<HTMLInputElement>(null)
	const tutor = useTutor(editor, voiceOut, library.active)

	useEffect(() => {
		try {
			setVoiceOut(localStorage.getItem(VOICE_KEY) === '1')
		} catch {}
	}, [])

	// Which voice answers (Fish Audio or the browser's), checked whenever voice is turned on.
	const [voiceProvider, setVoiceProvider] = useState<'fish' | 'elevenlabs' | 'browser' | null>(null)
	useEffect(() => {
		// The demo's pre-rendered clips (acknowledgements included) load first, so they aren't synthesized.
		if (voiceOut)
			Promise.all([checkSpeechProvider(), loadPackVoice()]).then(([p]) => {
				setVoiceProvider(p)
				warmAcks()
			})
	}, [voiceOut])

 useEffect(() => {
  const changed = () => { setVoiceNotice(''); void checkSpeechProvider().then(setVoiceProvider) }
  const fallback = (event: Event) => { setVoiceProvider('browser'); setVoiceNotice((event as CustomEvent<{ message: string }>).detail.message) }
  window.addEventListener('loci:voice-key', changed); window.addEventListener('loci:voice-fallback', fallback)
  return () => { window.removeEventListener('loci:voice-key', changed); window.removeEventListener('loci:voice-fallback', fallback) }
 }, [])

	const toggleVoice = () => {
		setVoiceOut((v) => {
			try {
				localStorage.setItem(VOICE_KEY, v ? '0' : '1')
			} catch {}
			return !v
		})
	}

	const ingest = useCallback(async (files: File[]) => { const ids = await ingestFiles(editor, files, setLoading); if (ids.length) setMaterialAdded(true); return ids }, [editor])

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
		saveTopic(editor, null)
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
		if (planning) return null
		const start = question.match(/^teach me(?:\s+about)?\s+(.+)/i)
		if (start) { setRequestedTopic(start[1].slice(0, 400)); setTopicRequest(n => n + 1); return null }
		const lesson = readTopic(editor)
		if (lesson && !lesson.complete) {
			const pages = sourcePages(editor)
			if (sourceFingerprint(pages.filter(p => lesson.sourceIds.includes(p.sourceId))) === lesson.fingerprint) {
				const result = await tutor.ask(question, { ...opts, lesson: lessonContext(lesson, pages, 'clarify', question) })
				if (result && !result.error && !result.stopped) { const current = readTopic(editor); if (current && current.current === lesson.current) saveTopic(editor, teachingCheckpoint(current, result.events, false)) }
				return result
			}
		}
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
		onLibrary({ active: id, boards: [...library.boards, { id, name: `Board ${library.boards.length + 1}`, updatedAt: Date.now(), spaceId: library.boards.find(b => b.id === library.active)?.spaceId }] })
	}

	const disabledReason = tutor.status.checked && !tutor.status.configured ? 'Connect a model to ask questions' : undefined

	return (
		<div
			className="loci-ui"
			data-replay={Boolean(replay)}
			onPasteCapture={(e) => {
				if (replay && e.clipboardData.files.length) { e.preventDefault(); e.stopPropagation(); return }
				// Editable fields bypass canvas paste handler. Accept files there too.
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
				account={account}
				status={tutor.status}
				voiceOut={voiceOut}
				voiceProvider={voiceProvider}
				onToggleVoice={toggleVoice}
				onClear={newBoard}
				busy={planning || tutor.busy || Boolean(loading) || tour.speaking || Boolean(replay)}
				library={<BoardLibrary onUpload={() => setAdding([])} library={library} account={Boolean(account)} disabled={planning || tutor.busy || Boolean(loading) || tour.speaking || Boolean(replay)} onSelect={(active) => onLibrary({ ...library, active })} onNew={newBoard} onNewSpace={(name) => onLibrary({ ...library, spaces: [...(library.spaces ?? []), { id: crypto.randomUUID(), name }] })} onMove={(spaceId) => onLibrary({ ...library, boards: library.boards.map(b => b.id === library.active ? { ...b, spaceId } : b) })} onRename={(name) => onLibrary({ ...library, boards: library.boards.map((b) => b.id === library.active ? { ...b, name } : b) })} />}
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
			{!replay && <Toolbar onUpload={() => setAdding([])} />}
			{!replay && <HoldToTalk busy={tutor.busy || planning} onAsk={ask} onStop={() => { tutor.stop(); if (planning) window.dispatchEvent(new Event('loci:cancel-topic-plan')) }} disabled={Boolean(disabledReason)} voice={voiceOut} />}
			{!replay && (tour.phase === 'start' ? (
				<TourStart tour={tour} overBoard={editor.getCurrentPageShapeIds().size > 0} />
			) : tour.phase === 'running' ? null : (
				<EmptyState saved={Boolean(account)} onUpload={() => setAdding([])} onSample={tour.pack?.steps.length ? startTour : loadSample} loading={loading} />
			))}
			{!replay && tour.phase !== 'running' && <TopicLesson busy={tutor.busy || Boolean(loading) || tour.speaking} requestedTopic={requestedTopic} requestKey={topicRequest} onPlanning={setPlanning} onQuota={tutor.updateQuota} onTeach={(question, lesson) => tutor.ask(question, { lesson })} />}
			{materialAdded && !replay && <div className="loci-material-added" onPointerDown={e => e.stopPropagation()}><span>Material added</span><button onClick={() => { setMaterialAdded(false); window.dispatchEvent(new Event('loci:focus-prompt')) }}>Ask about this</button><button onClick={() => { setMaterialAdded(false); setRequestedTopic(''); setTopicRequest(n => n + 1) }}>Teach me a topic</button><button aria-label="Dismiss material actions" onClick={() => setMaterialAdded(false)}>×</button></div>}
			{voiceNotice && <div className="loci-voice-notice" role="status" onPointerDown={e=>e.stopPropagation()}><span>{voiceNotice} Using browser voice.</span><button onClick={()=>{setKeyTab('voice');setKeyDialog(true)}}>Use your own voice key</button><button aria-label="Dismiss voice notice" onClick={()=>setVoiceNotice('')}>×</button></div>}
   {loading && <div className="loci-toast">{loading}</div>}
			{!replay && (record ? (
				<TourRecord tour={tour} busy={tutor.busy || planning} model={tutor.status.model} onRedo={tutor.undoLastTurn} />
			) : (
				<TourCoach tour={tour} busy={tutor.busy || planning} listening={voiceMode === 'listening'} transcribing={voiceMode === 'transcribing'} sending={voiceMode === 'thinking'} />
			))}
			{!replay && <TourEnd
				tour={tour}
				busy={tutor.busy || planning}
				onOwnProblem={() => setOwnNotes(true)}
				freeLeft={tutor.status.hosted && !tutor.status.pro && !tutor.userKey ? tutor.status.quota?.remaining : undefined}
			/>}
			<div className="loci-dock">
				{replay?.lessonId ? <LessonPlayer id={replay.lessonId} question={replay.question} onClose={() => setReplay(null)} /> : <ResponsePanel turns={tutor.turns} busy={tutor.busy || planning} status={tutor.status} onUndo={tutor.undoLastTurn} voice={voiceOut} onReplay={setReplay} />}
				<PromptBar
					busy={tutor.busy || planning}
					onAsk={(q, opts) => ask(q, opts)}
					onStop={() => { tutor.stop(); if (planning) window.dispatchEvent(new Event('loci:cancel-topic-plan')) }}
					disabledReason={disabledReason}
					pro={tutor.status.pro}
					talkDisabled={Boolean(replay)}
					freeLeft={tutor.status.hosted && !tutor.userKey ? tutor.status.quota?.remaining : undefined}
				/>
			</div>
			{keyDialog && <KeyDialog initialTab={keyTab} onClose={() => setKeyDialog(false)} />}
			{ownNotes && (
				<OwnProblem
					onClose={() => setOwnNotes(false)}
					onUpload={() => {
						setOwnNotes(false)
						setAdding([])
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
					if (files.length) setAdding(files)
				}}
			/>
			{adding && <AddMaterial key={adding.map(f => f.name).join('|')} files={adding} onChoose={() => fileRef.current?.click()} onText={async (text, role) => { const ids = await ingestArticle(editor, 'Pasted notes', text, role); if (ids.length) { setAdding(null); setMaterialAdded(true) } }} onLink={async (url, role, signal) => { const ids = await ingestLink(editor, url, role, signal, setLoading); if (ids.length) { setAdding(null); setMaterialAdded(true) } }} onClose={() => setAdding(null)} onAdd={(items) => {
				setAdding(null)
				void (async () => { for (const { file, role } of items) { const ids = await ingestFiles(editor, [file], setLoading, { role }); if (ids.length) setMaterialAdded(true) } })()
			}} />}
		</div>
	)
}

const SYNC_LABELS: Record<SyncState, string> = {
	opening: 'Opening…', saving: 'Saving…', saved: 'Saved', offline: 'Offline · saved on this device',
	error: 'Not saved', missing: 'Board not found', 'signed-out': 'Signed out · saved on this device',
}

/** An account board: opens once the account copy is in place, then keeps saving to it. */
function AccountBoard({ boardId, library, onLibrary }: { boardId: string; library: WorkspaceLibrary; onLibrary: (library: WorkspaceLibrary) => void }) {
	const editor = useEditor()
	const sync = useCloudSync(editor, boardId)
	const [error, setError] = useState('')
	const [pro, setPro] = useState(false)
	useEffect(() => { fetch('/api/account', { cache: 'no-store' }).then((r) => r.json()).then((a) => setPro(Boolean(a.pro))).catch(() => {}) }, [])
	useEffect(() => {
		const show = (e: Event) => setError((e as CustomEvent<string>).detail)
		window.addEventListener('loci:cloud-error', show)
		return () => window.removeEventListener('loci:cloud-error', show)
	}, [])
	if (sync.state === 'missing') return <div className="loci-loading">This board isn't in your account. <a href="/home">Go to your boards</a></div>
	const message = sync.notice || error || (sync.state === 'signed-out' ? 'Your session ended. Sign in again to keep saving to your account.' : '')
	return <>
		{message && <p className="loci-toast" role="alert">{message} <button onClick={() => { sync.dismissNotice(); setError('') }}>Dismiss</button></p>}
		{sync.ready
			? <Shell library={library} onLibrary={onLibrary} account={{ pro, saveState: <span className="loci-sync" data-state={sync.state} role="status">{SYNC_LABELS[sync.state]}</span> }} />
			: <div className="loci-loading">Opening your board…</div>}
	</>
}

/** Boards on this device (the demo), or, with `boardId`, a board saved to the signed-in account. */
export default function LociApp({ boardId }: { boardId?: string } = {}) {
	const router = useRouter()
	const [library, setLibrary] = useState<WorkspaceLibrary | null>(null)
	const [storageError, setStorageError] = useState(false)
	const [accountError, setAccountError] = useState('')
	useEffect(() => {
		if (!boardId) { setLibrary(readWorkspaces()); return }
		const only = { active: boardId, boards: [{ id: boardId, name: 'Board', updatedAt: Date.now() }] }
		listBoards()
			.then(({ boards, spaces }) => setLibrary({ active: boardId, spaces, boards: boards.length ? boards.map((b) => ({ id: b.id, name: b.name, spaceId: b.space_id, updatedAt: Date.parse(b.updated_at) })) : only.boards }))
			.catch(() => setLibrary(only))
	}, [boardId])
	const changeLibrary = (next: WorkspaceLibrary) => {
		if (!boardId) {
			try { writeWorkspaces(next); setLibrary(next) } catch { setStorageError(true) }
			return
		}
		const addedSpace = next.spaces?.find(s => !library?.spaces?.some(old => old.id === s.id))
		if (addedSpace) { void createSpace(addedSpace.name).then(space => setLibrary(current => current ? { ...current, spaces: [...(current.spaces ?? []), space] } : current)).catch(err => setAccountError(err instanceof Error ? err.message : 'Could not create the space.')); return }
		// Account boards: switching opens that board's page; a new id means a new board in the account.
		if (next.active !== library?.active) {
			if (library?.boards.some((b) => b.id === next.active)) { router.push(`/board/${next.active}`); return }
			const name = next.boards.find((b) => b.id === next.active)?.name ?? 'Untitled board'
			createBoard(name, next.boards.find(b => b.id === next.active)?.spaceId)
				.then((board) => window.location.assign(`/board/${board.id}${new URL(window.location.href).search}`))
				.catch((err) => setAccountError(err instanceof CloudError ? err.message : 'Could not create the board.'))
			return
		}
		const renamed = next.boards.find((b) => b.id === next.active)
		if (renamed) updateBoard(renamed.id, { name: renamed.name, spaceId: renamed.spaceId ?? null }).then(() => setLibrary(next)).catch(() => setAccountError('Could not rename the board.'))
	}


	if (!library) return <div className="loci-loading">Opening your board…</div>
	return (
		<div className="loci-root">
			{storageError && <p className="loci-toast">Browser storage is unavailable. Allow storage to save and switch boards.</p>}
			{accountError && <p className="loci-toast" role="alert">{accountError} <button onClick={() => setAccountError('')}>Dismiss</button></p>}
			<Whiteboard
				key={library.active}
				persistenceKey={canvasKey(library.active)}
				shapeUtils={shapeUtils}
				components={components}
			>
				{boardId ? <AccountBoard boardId={boardId} library={library} onLibrary={changeLibrary} /> : <Shell library={library} onLibrary={changeLibrary} />}
			</Whiteboard>
		</div>
	)
}
