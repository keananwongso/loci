/**
 * The tutor's words are heard, not read. The prompt asks the model to write for the ear; this is
 * the safety net for when it doesn't: dashes, markdown and stray LaTeX become plain speech.
 * Used for both the voice and the transcript, so what you read is what you heard.
 */

const GREEK: Record<string, string> = {
	alpha: 'alpha', beta: 'beta', gamma: 'gamma', delta: 'delta', epsilon: 'epsilon', theta: 'theta',
	lambda: 'lambda', mu: 'mu', pi: 'pi', sigma: 'sigma', phi: 'phi', omega: 'omega',
}

const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const ORDINAL = ['', '', 'half', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth']

/** "3/5" -> "three fifths", "1/2" -> "one half"; anything bigger reads as "a over b". */
export function spokenFraction(a: string, b: string): string {
	const n = Number(a)
	const d = Number(b)
	if (Number.isInteger(n) && Number.isInteger(d) && n >= 0 && n <= 10 && d >= 2 && d <= 10) {
		const unit = ORDINAL[d]
		return `${SMALL[n]} ${n === 1 ? unit : d === 2 ? 'halves' : `${unit}s`}`
	}
	return `${a} over ${b}`
}

/** LaTeX read aloud, approximately. Good enough for short inline math the model slipped in. */
export function latexToSpoken(latex: string): string {
	let s = latex
	// Colour wrappers carry no meaning when heard.
	for (let i = 0; i < 3; i++) s = s.replace(/\\color\{[^}]*\}\{([^{}]*)\}/g, '$1').replace(/\\color\{[^}]*\}/g, '')
	for (let i = 0; i < 3; i++) {
		s = s
			.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a: string, b: string) => ` ${spokenFraction(a.trim(), b.trim())} `)
			.replace(/\\sqrt\{([^{}]*)\}/g, ' the square root of $1 ')
			.replace(/\\(?:text|mathrm|mathbf|operatorname)\{([^{}]*)\}/g, '$1')
	}
	return s
		.replace(/\\left|\\right|\\[,;!]|\\quad|\\qquad/g, ' ')
		.replace(/\\nabla\s*f/g, ' the gradient of f ')
		.replace(/\\nabla/g, ' the gradient ')
		.replace(/\\cdot/g, ' dot ')
		.replace(/\\times/g, ' times ')
		.replace(/\\(?:Rightarrow|implies|to)/g, ' so ')
		.replace(/\\(?:le|leq)\b/g, ' is at most ')
		.replace(/\\(?:ge|geq)\b/g, ' is at least ')
		.replace(/\\(?:approx)\b/g, ' is about ')
		.replace(/\\(?:langle|rangle)/g, ' ')
		.replace(/\\\||‖/g, '|')
		.replace(/\|([^|]+)\|/g, ' the length of $1 ')
		.replace(/\\([a-zA-Z]+)/g, (_, name: string) => ` ${GREEK[name] ?? ''} `)
		.replace(/(\w)_\{?(\w+)\}?/g, '$1 sub $2')
		.replace(/\^\{?2\}?/g, ' squared')
		.replace(/\^\{?([^{}\s]+)\}?/g, ' to the $1')
		.replace(/\b(\d+)\s*\/\s*(\d+)\b/g, (_, a: string, b: string) => spokenFraction(a, b))
		.replace(/=/g, ' equals ')
		.replace(/\+/g, ' plus ')
		.replace(/(\s)-(\s)/g, '$1minus$2')
		.replace(/[{}]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

/** Plain speech from whatever the model wrote. */
export function toSpoken(text: string): string {
	return (
		text
			.replace(/\$\$?([^$]+)\$\$?/g, (_, m: string) => latexToSpoken(m))
			// Markdown has no sound.
			.replace(/\*\*([^*]+)\*\*/g, '$1')
			.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1$2')
			.replace(/`([^`]+)`/g, '$1')
			.replace(/^#+\s*/gm, '')
			.replace(/^\s*[-*•]\s+/gm, '')
			// Number ranges read as "to"; every other dash becomes a pause.
			.replace(/(\d)\s*[–—]\s*(\d)/g, '$1 to $2')
			.replace(/\s*[—–]\s*/g, ', ')
			.replace(/\s+--?\s+/g, ', ')
			.replace(/;/g, ',')
			.replace(/\s*\n+\s*/g, ' ')
			.replace(/\s+([,.?!])/g, '$1')
			.replace(/,\s*([,.?!])/g, '$1')
			.replace(/^[,\s]+/, '')
			.replace(/\s+/g, ' ')
			.trim()
	)
}
