import { describe, expect, it } from 'vitest'
import { canvasKey, conversationKey, shouldStartLesson } from './workspaces'
describe('workspace compatibility and returning visitors', () => {
	it('keeps the existing board and conversation addresses while isolating new boards', () => {
		expect(canvasKey('default')).toBe('loci-board')
		expect(conversationKey('default')).toBe('board-default')
		expect(canvasKey('new-board')).not.toBe(canvasKey('default'))
		expect(conversationKey('new-board')).not.toBe(conversationKey('default'))
	})
	it('only starts onboarding for a fresh first visit, even if a returning URL asks for it', () => {
		expect(shouldStartLesson(true, false, false)).toBe(true)
		expect(shouldStartLesson(true, true, false)).toBe(false)
		expect(shouldStartLesson(true, false, true)).toBe(false)
		expect(shouldStartLesson(false, false, false)).toBe(false)
	})
})
