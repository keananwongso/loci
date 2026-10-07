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

/** Manual ordering is a browser preference; account membership still comes from the server. */
const ORDER_KEY = 'loci:workspace-order:v1'
export function rememberWorkspaceOrder(library: WorkspaceLibrary) {
 localStorage.setItem(ORDER_KEY, JSON.stringify({ boards: library.boards.map(b=>b.id), spaces: (library.spaces ?? []).map(s=>s.id) }))
}
export function applyWorkspaceOrder(library: WorkspaceLibrary): WorkspaceLibrary {
 try {
  const order = JSON.parse(localStorage.getItem(ORDER_KEY) || 'null')
  const sort = <T extends {id:string}>(items:T[], ids:unknown):T[] => {
   if (!Array.isArray(ids)) return items
   const positions = new Map(ids.map((id,index)=>[id,index]))
   return [...items].sort((a,b)=>(positions.get(a.id) ?? Infinity)-(positions.get(b.id) ?? Infinity))
  }
  return { ...library, boards: sort(library.boards, order?.boards), spaces: sort(library.spaces ?? [], order?.spaces) }
 } catch { return library }
}
export function moveWorkspace(library: WorkspaceLibrary, id:string, spaceId:string|null, beforeId?:string): WorkspaceLibrary {
 const board = library.boards.find(b=>b.id===id)
 if (!board || (spaceId && !library.spaces?.some(s=>s.id===spaceId)) || id===beforeId) return library
 const boards = library.boards.filter(b=>b.id!==id)
 const target = beforeId ? boards.findIndex(b=>b.id===beforeId) : -1
 boards.splice(target<0 ? boards.length : target,0,{...board,spaceId})
 return {...library,boards}
}
export function removeWorkspace(library:WorkspaceLibrary,id:string):WorkspaceLibrary {
 if (!library.boards.some(b=>b.id===id)) return library
 let boards=library.boards.filter(b=>b.id!==id)
 if (!boards.length) boards=[{id:crypto.randomUUID(),name:'My board',updatedAt:Date.now()}]
 return {...library,boards,active:library.active===id ? boards[0].id : library.active}
}
export function removeSpace(library:WorkspaceLibrary,id:string):WorkspaceLibrary {
 return {...library,spaces:library.spaces?.filter(s=>s.id!==id),boards:library.boards.map(b=>b.spaceId===id ? {...b,spaceId:null} : b)}
}
