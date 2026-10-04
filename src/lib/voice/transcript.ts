/** Loci's voice input is English. Reject CJK misrecognitions instead of submitting a different question. */
export function cleanVoiceTranscript(text: string): string {
	const trimmed = text.trim()
	return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(trimmed) ? '' : trimmed
}
