'use client'
import katex from 'katex'

const cache = new Map<string, string>()

/** KaTeX HTML for `latex` (cached). Never throws; invalid input renders as a red error. */
export function renderLatex(latex: string, display = true): string {
	const key = `${display ? 'D' : 'I'}${latex}`
	let html = cache.get(key)
	if (!html) {
		html = katex.renderToString(latex, {
			displayMode: display,
			throwOnError: false,
			strict: 'ignore',
			trust: false,
			output: 'html',
		})
		if (cache.size > 500) cache.clear()
		cache.set(key, html)
	}
	return html
}

export const EQUATION_FONT_SIZE = { s: 20, m: 28, l: 40 } as const
export const EQUATION_PAD = { x: 12, y: 8 }

/** Measure rendered KaTeX in the DOM so equation shapes get their natural size. */
export function measureLatex(latex: string, fontSize: number): { w: number; h: number } {
	if (typeof document === 'undefined') return { w: 200, h: 60 }
	const el = document.createElement('div')
	// Same class as the shape, so the handwriting font is measured too.
	el.className = 'loci-hand'
	el.style.cssText = `position:absolute;left:-10000px;top:0;visibility:hidden;white-space:nowrap;font-size:${fontSize}px;display:inline-block`
	el.innerHTML = renderLatex(latex, false)
	document.body.appendChild(el)
	const rect = el.getBoundingClientRect()
	el.remove()
	return {
		w: Math.ceil(rect.width) + EQUATION_PAD.x * 2,
		h: Math.ceil(rect.height) + EQUATION_PAD.y * 2,
	}
}

/** Plain-text approximation of LaTeX, for svg export and speech. */
export function latexToPlain(latex: string): string {
	return latex
		.replace(/\\(left|right|,|;|!|quad|qquad)/g, ' ')
		.replace(/\\text\{([^}]*)\}/g, '$1')
		.replace(/\\nabla/g, '∇')
		.replace(/\\cdot/g, '·')
		.replace(/\\theta/g, 'θ')
		.replace(/\\pi/g, 'π')
		.replace(/\\Rightarrow/g, '⇒')
		.replace(/\\le(q)?/g, '≤')
		.replace(/\\ge(q)?/g, '≥')
		.replace(/\\\|/g, '‖')
		.replace(/\\([a-zA-Z]+)/g, '$1')
		.replace(/[{}]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
}
