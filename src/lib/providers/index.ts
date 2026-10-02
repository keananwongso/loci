import 'server-only'
import { AnthropicProvider } from './anthropic'
import { MockProvider } from './mock'
import { OpenAICompatibleProvider, type OpenAICompatibleConfig } from './openai-compatible'
import type { TutorModelProvider } from './types'

/** OpenAI-compatible services Loci knows the address of. Any other one works via LOCI_BASE_URL. */
export const PRESETS: Record<string, { baseUrl: string; keyEnv?: string; defaultModel?: string; extraHeaders?: Record<string, string> }> = {
	openrouter: { baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY', extraHeaders: { 'X-Title': 'Loci' } },
	openai: { baseUrl: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY' },
	deepseek: { baseUrl: 'https://api.deepseek.com', keyEnv: 'DEEPSEEK_API_KEY', defaultModel: 'deepseek-flash' },
	gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyEnv: 'GEMINI_API_KEY' },
	groq: { baseUrl: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY' },
	ollama: { baseUrl: 'http://localhost:11434/v1' },
	custom: { baseUrl: '' },
}

/** With no LOCI_PROVIDER, use whichever key is present (first match wins). */
function detectProvider(env: NodeJS.ProcessEnv): string {
	if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return 'anthropic'
	for (const [name, preset] of Object.entries(PRESETS)) {
		if (preset.keyEnv && env[preset.keyEnv]) return name
	}
	if (env.LOCI_BASE_URL) return 'custom'
	return 'anthropic'
}

function parseVision(value: string | undefined): OpenAICompatibleConfig['vision'] {
	if (value === 'on' || value === 'true') return true
	if (value === 'off' || value === 'false') return false
	return 'auto'
}

export function getProvider(env: NodeJS.ProcessEnv = process.env): TutorModelProvider {
	const name = (env.LOCI_PROVIDER || detectProvider(env)).toLowerCase()
	if (name === 'mock') return new MockProvider()
	if (name === 'anthropic') return new AnthropicProvider()

	const preset = PRESETS[name]
	if (!preset) {
		throw new Error(`Unknown LOCI_PROVIDER "${name}". Use anthropic, ${Object.keys(PRESETS).join(', ')} or mock.`)
	}
	const baseUrl = env.LOCI_BASE_URL || preset.baseUrl
	if (!baseUrl) throw new Error('LOCI_PROVIDER=custom needs LOCI_BASE_URL (an OpenAI-compatible endpoint ending in /v1).')
	return new OpenAICompatibleProvider({
		name,
		baseUrl,
		apiKey: env.LOCI_API_KEY || (preset.keyEnv ? env[preset.keyEnv] : undefined),
		keyEnv: name === 'custom' || name === 'ollama' ? undefined : preset.keyEnv,
		model: env.LOCI_MODEL || preset.defaultModel,
		vision: parseVision(env.LOCI_VISION),
		extraHeaders: preset.extraHeaders,
	})
}

export const USER_KEY_PROVIDERS = ['anthropic', 'openrouter', 'openai', 'deepseek', 'gemini', 'groq'] as const
export type UserKeyProvider = (typeof USER_KEY_PROVIDERS)[number]

/**
 * A provider using a visitor's own API key (hosted demo). The key is used for this one request
 * and never stored or logged. Custom base URLs are not accepted, so the server can only be
 * pointed at the known providers above.
 */
export function providerForUserKey(provider: string, apiKey: string, model?: string): TutorModelProvider {
	if (!(USER_KEY_PROVIDERS as readonly string[]).includes(provider)) throw new Error(`Unsupported provider "${provider}".`)
	if (provider === 'anthropic') return new AnthropicProvider({ apiKey, model })
	const preset = PRESETS[provider]
	return new OpenAICompatibleProvider({
		name: provider,
		baseUrl: preset.baseUrl,
		apiKey,
		keyEnv: preset.keyEnv,
		model: model || preset.defaultModel,
		vision: 'auto',
		extraHeaders: preset.extraHeaders,
	})
}
