/**
 * What a piece of material is for. Shown on the board and given to the tutor, which teaches from
 * notes, keeps to the syllabus's scope, works from the questions, and marks against the mark scheme.
 * Stored in the material shape's meta (with `doc` grouping the pages of one file), so boards saved
 * before roles existed still load.
 */
export const ROLES = ['notes', 'syllabus', 'questions', 'mark-scheme'] as const
export type MaterialRole = (typeof ROLES)[number]

export const ROLE_LABELS: Record<MaterialRole, string> = {
	notes: 'Notes',
	syllabus: 'Syllabus',
	questions: 'Questions',
	'mark-scheme': 'Mark scheme',
}

/** Roles whose text the tutor gets even when they are out of view: it consults them, it doesn't teach from them. */
export const isReference = (role: MaterialRole) => role === 'syllabus' || role === 'mark-scheme'

export const isRole = (v: unknown): v is MaterialRole => typeof v === 'string' && (ROLES as readonly string[]).includes(v)

/** A first guess from the file name; the student can change it on the board. */
export function guessRole(fileName: string): MaterialRole {
	const n = fileName.toLowerCase().replace(/[_\-.]+/g, ' ')
	if (/\b(mark ?scheme|marking|rubric|solutions?|answers?|answer key|memo)\b/.test(n)) return 'mark-scheme'
	if (/\b(syllabus|course outline|outline|curriculum|learning objectives)\b/.test(n)) return 'syllabus'
	if (/\b(exam|midterm|quiz|test|past paper|paper \d|problem set|pset|homework|hw ?\d*|assignment|worksheet|exercises?|questions?)\b/.test(n)) return 'questions'
	return 'notes'
}

export interface MaterialMeta {
	role?: MaterialRole
	/** Shared by every page of one uploaded file. */
	doc?: string
}

export const roleOf = (meta: unknown): MaterialRole => {
	const role = (meta as MaterialMeta | undefined)?.role
	return isRole(role) ? role : 'notes'
}
