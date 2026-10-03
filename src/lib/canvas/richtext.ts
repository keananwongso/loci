'use client'
import { renderLatex } from './katex'

function escapeHtml(s: string) {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function inline(s: string) {
	return escapeHtml(s)
		.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
		.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
		.replace(/`([^`]+)`/g, '<code>$1</code>')
}

/**
 * Minimal, safe rendering of the tutor's speech: escapes everything, then allows
 * **bold**, *italic*, `code`, and $math$ / $$math$$ via KaTeX (with trust disabled).
 */
export function renderRich(text: string): string {
	const parts = text.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g)
	return parts
		.map((part) => {
			if (part.startsWith('$$') && part.endsWith('$$') && part.length > 4) return renderLatex(part.slice(2, -2), true)
			if (part.startsWith('$') && part.endsWith('$') && part.length > 2) return renderLatex(part.slice(1, -1), false)
			return inline(part).replace(/\n/g, '<br/>')
		})
		.join('')
}
