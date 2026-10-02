import 'server-only'
import { AnthropicProvider } from './anthropic'
import { MockProvider } from './mock'
import type { TutorModelProvider } from './types'

/** Pick the provider from LOCI_PROVIDER (default: anthropic). */
export function getProvider(): TutorModelProvider {
	switch (process.env.LOCI_PROVIDER) {
		case 'mock':
			return new MockProvider()
		case 'anthropic':
		case undefined:
		case '':
			return new AnthropicProvider()
		default:
			throw new Error(`Unknown LOCI_PROVIDER "${process.env.LOCI_PROVIDER}". Use "anthropic" or "mock".`)
	}
}
