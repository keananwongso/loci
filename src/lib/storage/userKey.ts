'use client'
/** A visitor's own API key for the hosted demo. Kept only in this browser's localStorage. */

export interface UserKey {
	provider: 'anthropic' | 'openrouter' | 'openai' | 'deepseek' | 'gemini' | 'groq'
	key: string
	model?: string
}

const KEY = 'loci:user-key'

export function loadUserKey(): UserKey | null {
	try {
		const raw = localStorage.getItem(KEY)
		return raw ? (JSON.parse(raw) as UserKey) : null
	} catch {
		return null
	}
}

export function saveUserKey(value: UserKey | null) {
	try {
		if (value) localStorage.setItem(KEY, JSON.stringify(value))
		else localStorage.removeItem(KEY)
	} catch {}
	window.dispatchEvent(new CustomEvent('loci:user-key'))
}

export function userKeyHeaders(): Record<string, string> {
	const k = loadUserKey()
	if (!k?.key) return {}
	return { 'x-loci-key': k.key, 'x-loci-provider': k.provider, ...(k.model ? { 'x-loci-model': k.model } : {}) }
}
