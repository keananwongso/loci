import { describe, expect, it } from 'vitest'
import { wantsAck } from './ack'

describe('wantsAck', () => {
	it('stays quiet for small talk and short replies', () => {
		expect(wantsAck('hi')).toBe(false)
		expect(wantsAck('hey, how are you doing today?')).toBe(false)
		expect(wantsAck('thanks that makes sense now')).toBe(false)
		expect(wantsAck('the gradient one')).toBe(false)
	})

	it('stays quiet when the student is answering the tutor', () => {
		expect(wantsAck('it would get bigger because the angle shrinks', 'What happens to the slope if u turns toward the gradient?')).toBe(false)
	})

	it('acknowledges real questions', () => {
		expect(wantsAck('what is u geometrically in this formula?')).toBe(true)
		expect(wantsAck("honestly I'm just really lost with the whole thing", 'That is the whole idea.')).toBe(true)
	})
})
