import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadUserKey, removeLegacyUserKey, saveUserKey, userKeyHeaders } from './userKey'

const stored = new Map<string, string>()
const session = new Map<string, string>()
const setItem = vi.fn()
beforeEach(() => {
	stored.clear()
	session.clear()
	setItem.mockClear()
	const localStorage = { removeItem: (key: string) => stored.delete(key), setItem }
	const sessionStorage = { removeItem: (key: string) => session.delete(key), setItem }
	vi.stubGlobal('window', { localStorage, sessionStorage, dispatchEvent: vi.fn() })
	vi.stubGlobal('CustomEvent', class { constructor(public type: string) {} })
	saveUserKey(null)
})
afterEach(() => vi.unstubAllGlobals())

describe('bring your own key privacy', () => {
	it('uses a key for questions without writing it to either browser store', () => {
		const value = { provider: 'deepseek' as const, key: 'test-only-key', model: 'deepseek-flash' }
		saveUserKey(value)
		expect(loadUserKey()).toEqual(value)
		expect(userKeyHeaders()).toEqual({ 'x-loci-key': value.key, 'x-loci-provider': value.provider, 'x-loci-model': value.model })
		expect(setItem).not.toHaveBeenCalled()
	})
	it('forgets the key when the page module reloads', async () => {
		saveUserKey({ provider: 'deepseek', key: 'test-only-key' })
		vi.resetModules()
		const reloaded = await import('./userKey')
		expect(reloaded.loadUserKey()).toBeNull()
		expect(reloaded.userKeyHeaders()).toEqual({})
	})
	it('deletes legacy credentials without restoring them', () => {
		stored.set('loci:user-key', JSON.stringify({ provider: 'deepseek', key: 'legacy-secret' }))
		session.set('loci:user-key', 'legacy-secret')
		stored.set('loci:workspaces:v1', 'boards')
		removeLegacyUserKey()
		expect(stored.has('loci:user-key')).toBe(false)
		expect(session.has('loci:user-key')).toBe(false)
		expect(stored.get('loci:workspaces:v1')).toBe('boards')
		expect(loadUserKey()).toBeNull()
	})
	it('removes the in-memory credential and stops attaching it to questions', () => {
		saveUserKey({ provider: 'anthropic', key: 'test-only-key' })
		saveUserKey(null)
		expect(loadUserKey()).toBeNull()
		expect(userKeyHeaders()).toEqual({})
	})
	it('works when browser storage is blocked', () => {
		Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage blocked') } })
		Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Storage blocked') } })
		saveUserKey({ provider: 'anthropic', key: 'test-only-key' })
		expect(userKeyHeaders()).toEqual({ 'x-loci-key': 'test-only-key', 'x-loci-provider': 'anthropic' })
	})
})
