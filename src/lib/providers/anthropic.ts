import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { historyAsText } from '@/lib/tutor/prompt'
import { toSpoken } from '@/lib/voice/spoken'
import type { ActionSession } from '@/lib/tutor/session'
import type { TutorEvent } from '@/lib/tutor/types'
import type { TutorInput, TutorModelProvider } from './types'
import { ThoughtStream } from '@/lib/tutor/thoughts'

type Effort = 'low' | 'medium' | 'high'

const MAX_ROUNDS = 6

export class AnthropicProvider implements TutorModelProvider {
	readonly name = 'anthropic'
	readonly model: string
	readonly setupHint = 'Add an API key to .env.local (ANTHROPIC_API_KEY, or OPENROUTER_API_KEY, DEEPSEEK_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY...) and restart `npm run dev`.'
	private effort: Effort

	private apiKey?: string
	private makeClient: () => Anthropic

	/**
	 * By default the SDK reads the key from the server environment. `apiKey` is a visitor's own
	 * key (hosted demo, bring your own key); `makeClient` exists for tests.
	 */
	constructor(opts: { apiKey?: string; model?: string; makeClient?: () => Anthropic } = {}) {
		this.apiKey = opts.apiKey
		this.model = opts.model || process.env.LOCI_MODEL || 'claude-opus-5-5'
		const effort = process.env.LOCI_EFFORT
		this.effort = effort === 'low' || effort === 'high' ? effort : 'medium'
		this.makeClient = opts.makeClient ?? (() => (this.apiKey ? new Anthropic({ apiKey: this.apiKey }) : new Anthropic()))
	}

	isConfigured() {
		return Boolean(this.apiKey || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)
	}

	describeError(err: unknown) {
		return describeAnthropicError(err)
	}

	async run(input: TutorInput, session: ActionSession, emit: (e: TutorEvent) => void, signal: AbortSignal) {
		// The key is read from the server environment only; it never reaches the browser.
		const client = this.makeClient()

		const tools: Anthropic.Beta.BetaTool[] = input.tools.map((t) => ({
			name: t.name,
			description: t.description,
			input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
		}))

		const messages: Anthropic.Beta.BetaMessageParam[] = []
		for (const turn of input.request.history) {
			const { user, assistant } = historyAsText(turn)
			messages.push({ role: 'user', content: user }, { role: 'assistant', content: assistant })
		}

		const current: Anthropic.Beta.BetaContentBlockParam[] = []
		for (const image of input.request.images) {
			current.push({ type: 'text', text: `Image: ${image.label}` })
			current.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } })
		}
		current.push({ type: 'text', text: input.turnText })
		messages.push({ role: 'user', content: current })

		for (let round = 0; round < MAX_ROUNDS; round++) {
			const stream = client.beta.messages.stream(
				{
					model: this.model,
					max_tokens: 32000,
					// Tool inputs here are small, so the default (buffered, server-validated) tool
					// input streaming is used; each call is still re-validated with Zod in the session.
					system: [{ type: 'text', text: input.system, cache_control: { type: 'ephemeral' } }],
					tools,
					tool_choice: { type: 'auto' },
					messages,
					output_config: { effort: this.effort },
					// If a safety classifier declines, retry on a fallback model chosen by the API.
					betas: ['server-side-fallback-2026-07-01'],
					fallbacks: 'default',
				},
				{ signal }
			)

			// Run each tool call as soon as its block completes, so drawing starts while the
			// model is still generating the rest of the turn.
			const results = new Map<string, Anthropic.Beta.BetaToolResultBlockParam>()
			// Show what each call is doing while its input is still streaming in.
			const thoughts = new ThoughtStream(emit)
			stream.on('streamEvent', (event) => {
				if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
					thoughts.update(event.index, { tool: event.content_block.name })
				} else if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
					thoughts.update(event.index, { args: event.delta.partial_json })
				}
			})
			stream.on('contentBlock', (block) => {
				if (block.type === 'tool_use') {
					const outcome = session.handle(block.name, block.input)
					results.set(block.id, {
						type: 'tool_result',
						tool_use_id: block.id,
						content: outcome.ok ? outcome.result : outcome.error,
						is_error: !outcome.ok,
					})
				} else if (block.type === 'text' && toSpoken(block.text)) {
					// Plain text is also shown to the student, in case the model skips `say`.
					emit({ type: 'say', text: toSpoken(block.text) })
				}
			})

			const message = await stream.finalMessage()

			if (message.stop_reason === 'refusal') {
				emit({ type: 'error', message: 'The model declined to answer this request.' })
				return
			}
			const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
			if (message.stop_reason !== 'tool_use' || toolUses.length === 0) {
				if (message.stop_reason === 'max_tokens') emit({ type: 'status', message: 'Response hit the length limit.' })
				return
			}

			// Append the assistant turn unchanged (thinking blocks included), then all results in one message.
			messages.push({ role: 'assistant', content: message.content })
			messages.push({
				role: 'user',
				content: toolUses.map(
					(t) =>
						results.get(t.id) ?? {
							type: 'tool_result' as const,
							tool_use_id: t.id,
							content: 'Not executed.',
							is_error: true,
						}
				),
			})

			// Stop early once the model has only spoken; a final round would add nothing.
			// Only spoke: the answer is complete (several sentences, or any later round). A lone first
			// sentence may be a model that calls one tool at a time, so it gets another round.
			if (toolUses.every((t) => t.name === 'say') && (round > 0 || toolUses.length > 1)) return
		}
	}
}

/** Translate SDK errors into messages a student can act on. */
export function describeAnthropicError(err: unknown): string {
	if (err instanceof Anthropic.AuthenticationError) return 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env.local.'
	if (err instanceof Anthropic.PermissionDeniedError) return 'This API key does not have access to the configured model.'
	if (err instanceof Anthropic.NotFoundError) return 'Model not found. Check LOCI_MODEL in .env.local.'
	if (err instanceof Anthropic.RateLimitError) return 'Rate limited by the Anthropic API. Wait a moment and try again.'
	if (err instanceof Anthropic.BadRequestError) return `The request was rejected: ${err.message}`
	if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API. Check your internet connection.'
	if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status ?? ''}: ${err.message}`
	if (err instanceof Error && /authentication|api key/i.test(err.message)) return 'No Anthropic API key found. Add ANTHROPIC_API_KEY to .env.local.'
	return err instanceof Error ? err.message : 'Unknown error'
}
