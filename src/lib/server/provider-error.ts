/** Upstream errors can echo authorization headers. Never return or log their text. */
export function safeProviderFailure(error: unknown) {
	const candidate = error && typeof error === 'object' && 'status' in error ? error.status : undefined
	const status = typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : undefined
	let message = 'The model request failed. Please try again.'
	if (status === 401 || status === 403) message = 'The provider rejected the API key or model access. Check your key and provider permissions.'
	else if (status === 404) message = 'The provider could not find that model. Check the model ID.'
	else if (status === 429) message = 'Your provider rate limit or quota was reached. Check your balance or try again later.'
	else if (status === 400 || status === 422) message = 'The provider rejected this request. Check that the selected model supports tool calling and your uploaded content.'
	else if (status !== undefined && status >= 500) message = 'The model provider is temporarily unavailable. Please try again later.'
	else if (error instanceof TypeError) message = 'Could not reach the model provider. Please try again.'
	return { status, message }
}
