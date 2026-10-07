import { describe, expect, it } from 'vitest'
import { providerForUserKey } from './index'

describe('user provider settings', () => {
	it('accepts a known provider and model without selecting a custom destination', () => {
		const provider = providerForUserKey('openrouter', 'test-only-key', 'anthropic/claude-opus-5-5')
		expect(provider.name).toBe('openrouter')
		expect(provider.model).toBe('anthropic/claude-opus-5-5')
		expect(provider.isConfigured()).toBe(true)
	})
	it('rejects unknown destinations without echoing the submitted value', () => {
		expect(() => providerForUserKey('https://attacker.example/sk-secret', 'test-only-key')).toThrow('Unsupported provider.')
	})
	it.each(['', 'key\nwith-newline', 'key with spaces', 'x'.repeat(4097)])('rejects invalid credentials before making an upstream request', (key) => {
		expect(() => providerForUserKey('deepseek', key)).toThrow('Invalid API key format.')
	})
	it.each(['model\nwith-newline', 'model with spaces', 'x'.repeat(121)])('rejects malformed model IDs without truncating or echoing them', (model) => {
		expect(() => providerForUserKey('deepseek', 'test-only-key', model)).toThrow('Invalid model ID.')
	})
})
