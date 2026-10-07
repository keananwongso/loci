import { describe, expect, it } from 'vitest'
import { canvasKey, conversationKey, shouldStartLesson, moveWorkspace, removeWorkspace, removeSpace } from './workspaces'
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

describe('board organization',()=>{
 const library={active:'a',boards:[{id:'a',name:'A',updatedAt:1},{id:'b',name:'B',updatedAt:2},{id:'c',name:'C',updatedAt:3,spaceId:'math'}],spaces:[{id:'math',name:'Math'}]}
 it('moves a board into a space without changing the active board or its identity',()=>{
  const moved=moveWorkspace(library,'a','math','c')
  expect(moved.active).toBe('a');expect(moved.boards.map(b=>b.id)).toEqual(['b','a','c']);expect(moved.boards[1].spaceId).toBe('math')
  expect(moveWorkspace(library,'a','missing')).toBe(library)
 })
 it('removes a space while preserving all its boards',()=>{
  const next=removeSpace(library,'math');expect(next.spaces).toEqual([]);expect(next.boards).toHaveLength(3);expect(next.boards[2].spaceId).toBeNull()
 })
 it('switches away from a deleted board and creates a fresh board when the last is removed',()=>{
  expect(removeWorkspace(library,'a').active).toBe('b')
  const next=removeWorkspace({...library,boards:[library.boards[0]]},'a')
  expect(next.boards).toHaveLength(1);expect(next.active).not.toBe('a');expect(next.active).toBe(next.boards[0].id);expect(next.spaces).toEqual(library.spaces)
 })
})
