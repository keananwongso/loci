import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadUserKey, saveUserKey, userKeyHeaders } from './userKey'

const stored = new Map<string, string>()
beforeEach(() => {
	stored.clear()
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => stored.get(key) ?? null,
		setItem: (key: string, value: string) => stored.set(key, value),
		removeItem: (key: string) => stored.delete(key),
	})
	vi.stubGlobal('window', { dispatchEvent: vi.fn() })
	vi.stubGlobal('CustomEvent', class { constructor(public type: string) {} })
})
afterEach(() => vi.unstubAllGlobals())

describe('bring your own key storage', () => {
	it('keeps the saved key across a module reload and sends it with the chosen model', async () => {
		const value = { provider: 'deepseek' as const, key: 'test-only-key', model: 'deepseek-flash' }
		saveUserKey(value)
		vi.resetModules()
		const reloaded = await import('./userKey')
		expect(reloaded.loadUserKey()).toEqual(value)
		expect(reloaded.userKeyHeaders()).toEqual({ 'x-loci-key': value.key, 'x-loci-provider': value.provider, 'x-loci-model': value.model })
	})
	it('removes the saved credential and stops attaching it to questions', () => {
		saveUserKey({ provider: 'anthropic', key: 'test-only-key' })
		saveUserKey(null)
		expect(stored.has('loci:user-key')).toBe(false)
		expect(loadUserKey()).toBeNull()
		expect(userKeyHeaders()).toEqual({})
	})
	it('leaves model selection to the provider when no model is saved', () => {
		saveUserKey({ provider: 'anthropic', key: 'test-only-key' })
		expect(userKeyHeaders()).toEqual({ 'x-loci-key': 'test-only-key', 'x-loci-provider': 'anthropic' })
	})
	it('treats unreadable storage as having no saved credential', () => {
		stored.set('loci:user-key', 'invalid JSON')
		expect(loadUserKey()).toBeNull()
		expect(userKeyHeaders()).toEqual({})
	})
})
