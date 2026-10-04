/** Match live speech to the displayed script, preserving order and repeated words. */
export function spokenScriptWords(script: string, transcript: string): Set<number> {
	const tokenize = (text: string) => text.toLowerCase().replace(/[’']/g, '').replace(/\bwhats\b/g, 'what is').match(/[\p{L}\p{N}]+/gu) ?? []
	const words = script.split(/\s+/)
	const expected = words.flatMap((word, index) => tokenize(word).map((text) => ({ text, index })))
	// Only a short script is shown; cap the transcript to keep interim updates cheap.
	const heard = tokenize(transcript).slice(0, 160)
	const lengths = Array.from({ length: expected.length + 1 }, () => new Array<number>(heard.length + 1).fill(0))
	for (let i = expected.length - 1; i >= 0; i--) {
		for (let j = heard.length - 1; j >= 0; j--) {
			lengths[i][j] = expected[i].text === heard[j] ? 1 + lengths[i + 1][j + 1] : Math.max(lengths[i + 1][j], lengths[i][j + 1])
		}
	}
	const matched = new Set<number>()
	let i = 0
	let j = 0
	while (i < expected.length && j < heard.length) {
		if (expected[i].text === heard[j]) {
			matched.add(i)
			i++
			j++
		} else if (lengths[i + 1][j] > lengths[i][j + 1]) i++
		else j++
	}
	return new Set(words.flatMap((_, index) => {
		const tokens = expected.flatMap((token, tokenIndex) => token.index === index ? [tokenIndex] : [])
		return tokens.length && tokens.every((tokenIndex) => matched.has(tokenIndex)) ? [index] : []
	}))
}
