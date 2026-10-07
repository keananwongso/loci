import { expect, it } from 'vitest'
import { captionParts, captionAt } from './captions'
it('keeps the closing clause intact and preserves every word', () => {
 const text = "Hey there, good to see you! Point me at whatever you're working on and we'll dig in together."
 const parts = captionParts(text, 60)
 expect(parts.at(-1)).toBe("and we'll dig in together.")
 expect(parts.join(' ')).toBe(text)
 expect(parts.every(part => part.length <= 60)).toBe(true)
 expect(captionAt(parts, 0)).toBe(parts[0])
 expect(captionAt(parts, 1)).toBe(parts.at(-1))
})
it('splits long clauses at word boundaries and adapts to narrow widths', () => {
 const text = 'A long explanation with many words that should remain readable on a narrow screen.'
 const parts = captionParts(text, 24)
 expect(parts.join(' ')).toBe(text)
 expect(parts.every(part => part.length <= 24)).toBe(true)
})
