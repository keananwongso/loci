/** Split spoken text at sentence/clause boundaries, then at words for long clauses. */
export function captionParts(text: string, limit = 72): string[] {
	const clauses = text.trim().split(/(?<=[.!?;,])\s+|\s+(?=(?:and|but|so|then|which)\b)/i).filter(Boolean)
	const parts: string[] = []
	for (const clause of clauses) {
		const previous = parts.at(-1)
		if (clause.length <= limit) {
			if (previous && previous.length + clause.length + 1 <= limit) parts[parts.length - 1] += ` ${clause}`
			else parts.push(clause)
			continue
		}
		parts.push('')
		for (const word of clause.split(/\s+/)) {
			const last = parts.at(-1)
			if (last && last.length + word.length + 1 <= limit) parts[parts.length - 1] += ` ${word}`
			else parts.push(word)
		}
	}
	return parts.filter(Boolean)
}

export function captionAt(parts: string[], progress: number): string {
	const total = parts.reduce((sum, part) => sum + part.split(/\s+/).length, 0)
	const at = Math.max(0, Math.min(1, progress)) * total
	let end = 0
	return parts.find((part) => { end += part.split(/\s+/).length; return at < end }) ?? parts.at(-1) ?? ''
}
