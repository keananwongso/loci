/** The board library is local to this browser. Existing single-board data keeps its keys. */
export interface Workspace { id: string; name: string; updatedAt: number; spaceId?: string | null }
export interface WorkspaceLibrary { active: string; boards: Workspace[]; spaces?: { id: string; name: string }[] }
const KEY = 'loci:workspaces:v1'
const fallback = (): WorkspaceLibrary => ({ active: 'default', boards: [{ id: 'default', name: 'My board', updatedAt: Date.now() }] })

export function readWorkspaces(): WorkspaceLibrary {
	try {
		const data = JSON.parse(localStorage.getItem(KEY) || 'null')
		if (data && Array.isArray(data.boards) && data.boards.length && data.boards.every((b: Workspace) => typeof b.id === 'string' && /^[\w-]+$/.test(b.id) && typeof b.name === 'string') && data.boards.some((b: Workspace) => b.id === data.active)) return data
	} catch {}
	return fallback()
}

export function writeWorkspaces(library: WorkspaceLibrary) {
	localStorage.setItem(KEY, JSON.stringify(library))
	window.dispatchEvent(new Event('loci:workspaces'))
}

export const canvasKey = (id: string) => id === 'default' ? 'loci-board' : `loci-board-${id}`
export const conversationKey = (id: string) => id === 'default' ? 'board-default' : `board-${id}`

/** First-run links must never clear a returning student's board. */
export function shouldStartLesson(requested: boolean, seen: boolean, hasWork: boolean) {
	return requested && !seen && !hasWork
}
