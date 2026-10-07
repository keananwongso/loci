'use client'
/** A visitor's API key lives only in this page's memory, never in browser storage. */

export interface UserKey {
	provider: 'anthropic' | 'openrouter' | 'openai' | 'deepseek' | 'gemini' | 'groq'
	key: string
	model?: string
}

const LEGACY_KEY = 'loci:user-key'
let currentKey: UserKey | null = null

/** Delete credentials saved by earlier versions without reading or migrating them. */
export function removeLegacyUserKey() {
	for (const storage of ['localStorage', 'sessionStorage'] as const) {
		try { window[storage].removeItem(LEGACY_KEY) } catch {}
	}
}

export function loadUserKey(): UserKey | null {
	removeLegacyUserKey()
	return currentKey ? { ...currentKey } : null
}

export function saveUserKey(value: UserKey | null) {
	removeLegacyUserKey()
	currentKey = value ? { ...value } : null
	window.dispatchEvent(new CustomEvent('loci:user-key'))
}

export function userKeyHeaders(): Record<string, string> {
	const k = loadUserKey()
	if (!k?.key) return {}
	return { 'x-loci-key': k.key, 'x-loci-provider': k.provider, ...(k.model ? { 'x-loci-model': k.model } : {}) }
}
