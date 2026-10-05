/** The conversation for the board, kept in local IndexedDB next to the canvas. */
import { createStore, del, get, set } from 'idb-keyval'
import type { CanvasAction } from '@/lib/actions/schema'

export interface Turn {
	id: string
	turn: number
	question: string
	/** What the student was pointing at, for display. */
	context: string
	said: string[]
	actions: string[]
	status: 'looking' | 'thinking' | 'teaching' | 'done' | 'error' | 'stopped'
	error?: string
	notices?: string[]
	lastAction?: CanvasAction['type']
	undone?: boolean
	/** Hosted demo: which free-question limit refused this turn. */
	limitReached?: string
	/** A locally saved, seekable explanation with the original audio and canvas. */
	lessonId?: string
}

const store = typeof indexedDB !== 'undefined' ? createStore('loci-conversation', 'turns') : undefined
import { conversationKey } from './workspaces'

export async function loadConversation(boardId = 'default'): Promise<Turn[]> {
	const turns = (await get<Turn[]>(conversationKey(boardId), store)) ?? []
	// A turn interrupted by a reload is finished as far as we're concerned.
	return turns.map((t) => (['looking', 'thinking', 'teaching'].includes(t.status) ? { ...t, status: 'stopped' } : t))
}

export async function saveConversation(turns: Turn[], boardId = 'default') {
	await set(conversationKey(boardId), turns, store)
}

export async function clearConversation(boardId = 'default') {
	await del(conversationKey(boardId), store)
}
