'use client'
/**
 * A timeline of one question, logged to the console (and so to the dev server's terminal):
 * seconds since the student let go of the talk keys, or pressed send, for each moment they would
 * notice. Each label is logged once per question.
 */
let start = 0
const seen = new Set<string>()

export function startTimeline(label: string) {
	start = performance.now()
	seen.clear()
	mark(label)
}

export function mark(label: string) {
	if (!start || seen.has(label)) return
	seen.add(label)
	console.info(`[loci] +${((performance.now() - start) / 1000).toFixed(2)}s ${label}`)
}

export function endTimeline(label = 'turn done') {
	mark(label)
	start = 0
}
