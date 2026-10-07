import { describe, expect, it } from 'vitest'
import { safeProviderFailure } from './provider-error'

describe('provider error privacy', () => {
	it.each([400, 401, 403, 404, 422, 429, 500, 503])('keeps status %s useful without exposing upstream credentials or context', (status) => {
		const secret = 'sk-secret-from-authorization'
		const error = Object.assign(new Error(`Authorization: Bearer ${secret}; private lecture text`), {
			status, body: secret, headers: { authorization: secret },
		})
		const result = safeProviderFailure(error)
		expect(result.status).toBe(status)
		expect(JSON.stringify(result)).not.toContain(secret)
		expect(result.message).not.toContain('private lecture text')
	})
	it('does not expose unknown thrown values or malformed status fields', () => {
		for (const error of ['sk-secret', { status: 'sk-secret' }, new Error('sk-secret'), null]) {
			expect(safeProviderFailure(error)).toEqual({ status: undefined, message: 'The model request failed. Please try again.' })
		}
	})
})
