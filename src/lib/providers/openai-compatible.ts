import 'server-only'
/**
 * One provider for every API that speaks the OpenAI chat-completions format with tool calling:
 * OpenAI, OpenRouter, DeepSeek, Gemini (OpenAI endpoint), Groq, Ollama, LM Studio, and others.
 * Plain fetch, no SDK: only `/chat/completions` with streaming is used.
 */
import { historyAsText, buildTurnText } from '@/lib/tutor/prompt'
import type { ActionSession } from '@/lib/tutor/session'
import type { TutorEvent } from '@/lib/tutor/types'
import type { TutorInput, TutorModelProvider } from './types'

export interface OpenAICompatibleConfig {
	/** Shown in the UI, e.g. "openrouter". */
	name: string
	baseUrl: string
	apiKey?: string
	model?: string
	/** true / false, or 'auto' = send images and fall back to text-only if the API rejects them. */
	vision: boolean | 'auto'
	/** Name of the env var holding the key, for setup hints. */
	keyEnv?: string
	extraHeaders?: Record<string, string>
	fetch?: typeof fetch
	/** How this provider was picked, for setup hints (e.g. "found OPENROUTER_API_KEY"). */
	chosenBecause?: string
}

type ChatMessage =
	| { role: 'system' | 'user'; content: string | ContentPart[] }
	| { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
	| { role: 'tool'; tool_call_id: string; content: string }
type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } }

const MAX_ROUNDS = 6

/** Models the API refused images for, remembered for the life of the server. */
const textOnlyModels = new Set<string>()

class HttpError extends Error {
	constructor(
		readonly status: number,
		readonly body: string
	) {
		super(`HTTP ${status}: ${body.slice(0, 300)}`)
	}
}

/**
 * Loosen JSON schemas for providers with partial JSON Schema support (Gemini in particular
 * rejects some keywords). Safe: every tool input is re-validated with the full Zod schema.
 */
function loosen(node: unknown): unknown {
	if (Array.isArray(node)) return node.map(loosen)
	if (!node || typeof node !== 'object') return node
	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(node)) {
		if (k === 'pattern' || k === 'additionalProperties' || k === '$schema') continue
		out[k] = loosen(v)
	}
	return out
}

export class OpenAICompatibleProvider implements TutorModelProvider {
	readonly name: string
	readonly model: string
	readonly setupHint: string

	constructor(private config: OpenAICompatibleConfig) {
		this.name = config.name
		this.model = config.model ?? ''
		const missing = []
		if (!config.model) missing.push('LOCI_MODEL')
		if (!config.apiKey && config.keyEnv) missing.push(config.keyEnv)
		const why = config.chosenBecause ? ` (${config.chosenBecause})` : ''
		this.setupHint = missing.length
			? `Loci is using ${config.name}${why}, which needs ${missing.join(' and ')}. Set it in .env.local, or set LOCI_PROVIDER to the provider you meant (e.g. deepseek), then restart \`npm run dev\`.`
			: ''
	}

	isConfigured() {
		return Boolean(this.config.model && (this.config.apiKey || !this.config.keyEnv))
	}

	describeError(err: unknown): string {
		if (err instanceof HttpError) {
			if (err.status === 401 || err.status === 403) return `${this.name} rejected the API key (${err.status}). Check your key in .env.local.`
			if (err.status === 404) return `${this.name} could not find model "${this.model}" (404). Check LOCI_MODEL.`
			if (err.status === 429) return `${this.name} rate limit or quota reached. Wait a moment and try again.`
			if (/tool|function/i.test(err.body)) return `Model "${this.model}" does not seem to support tool calling, which Loci needs. Try another model. (${err.status})`
			return `${this.name} error ${err.status}: ${err.body.slice(0, 200)}`
		}
		if (err instanceof TypeError && /fetch/i.test(err.message)) return `Could not reach ${this.config.baseUrl}. Is the service running and the URL right?`
		return err instanceof Error ? err.message : String(err)
	}

	async run(input: TutorInput, session: ActionSession, emit: (e: TutorEvent) => void, signal: AbortSignal) {
		const wantsVision = this.config.vision !== false && !textOnlyModels.has(this.model) && input.request.images.length > 0
		try {
			await this.loop(input, session, emit, signal, wantsVision)
		} catch (err) {
			// Auto mode: if the very first request was refused because of images, retry text-only.
			if (wantsVision && this.config.vision === 'auto' && err instanceof HttpError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 429 && session.summaries.length === 0 && session.spoken.length === 0) {
				textOnlyModels.add(this.model)
				emit({ type: 'status', message: `${this.model} can't read images, so Loci is using text only.` })
				await this.loop(input, session, emit, signal, false)
				return
			}
			throw err
		}
	}

	private async loop(input: TutorInput, session: ActionSession, emit: (e: TutorEvent) => void, signal: AbortSignal, vision: boolean) {
		const tools = input.tools.map((t) => ({
			type: 'function' as const,
			function: { name: t.name, description: t.description, parameters: loosen(t.inputSchema) },
		}))

		const messages: ChatMessage[] = [{ role: 'system', content: input.system }]
		for (const turn of input.request.history) {
			const { user, assistant } = historyAsText(turn)
			messages.push({ role: 'user', content: user }, { role: 'assistant', content: assistant })
		}
		if (vision) {
			const parts: ContentPart[] = []
			for (const image of input.request.images) {
				parts.push({ type: 'text', text: `Image: ${image.label}` })
				parts.push({ type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.data}` } })
			}
			parts.push({ type: 'text', text: input.turnText })
			messages.push({ role: 'user', content: parts })
		} else {
			messages.push({ role: 'user', content: buildTurnText(input.request, { vision: false }) })
		}

		for (let round = 0; round < MAX_ROUNDS; round++) {
			const { content, toolCalls, finish } = await this.complete(messages, tools, session, signal)
			if (content.trim()) emit({ type: 'say', text: content.trim() })
			if (!toolCalls.length) return
			if (finish === 'length') {
				emit({ type: 'status', message: 'Response hit the length limit.' })
				return
			}
			messages.push({ role: 'assistant', content: content || null, tool_calls: toolCalls.map((t) => t.call) })
			for (const t of toolCalls) messages.push({ role: 'tool', tool_call_id: t.call.id, content: t.result })
			if (round > 0 && toolCalls.every((t) => t.call.function.name === 'say')) return
		}
	}

	/** One streamed completion. Each tool call is executed as soon as its arguments are complete. */
	private async complete(
		messages: ChatMessage[],
		tools: unknown[],
		session: ActionSession,
		signal: AbortSignal
	): Promise<{ content: string; toolCalls: Array<{ call: ToolCall; result: string }>; finish: string | null }> {
		const doFetch = this.config.fetch ?? fetch
		const res = await doFetch(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
			method: 'POST',
			signal,
			headers: {
				'Content-Type': 'application/json',
				...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
				...this.config.extraHeaders,
			},
			body: JSON.stringify({ model: this.model, messages, tools, tool_choice: 'auto', stream: true }),
		})
		if (!res.ok || !res.body) throw new HttpError(res.status, await res.text().catch(() => ''))

		let content = ''
		let finish: string | null = null
		const pending = new Map<number, { id: string; name: string; args: string }>()
		const done: Array<{ call: ToolCall; result: string }> = []
		const flush = (index: number) => {
			const p = pending.get(index)
			if (!p) return
			pending.delete(index)
			const call: ToolCall = { id: p.id || `call_${index}_${done.length}`, type: 'function', function: { name: p.name, arguments: p.args || '{}' } }
			let parsed: unknown
			try {
				parsed = JSON.parse(call.function.arguments)
			} catch {
				done.push({ call, result: `Error: arguments were not valid JSON: ${call.function.arguments.slice(0, 300)}` })
				return
			}
			const outcome = session.handle(call.function.name, parsed)
			done.push({ call, result: outcome.ok ? outcome.result : `Error: ${outcome.error}` })
		}

		const reader = res.body.getReader()
		const decoder = new TextDecoder()
		let buffer = ''
		for (;;) {
			const { value, done: end } = await reader.read()
			if (end) break
			buffer += decoder.decode(value, { stream: true })
			let nl: number
			while ((nl = buffer.indexOf('\n')) >= 0) {
				const line = buffer.slice(0, nl).trim()
				buffer = buffer.slice(nl + 1)
				if (!line.startsWith('data:')) continue
				const data = line.slice(5).trim()
				if (data === '[DONE]') continue
				let chunk: {
					error?: { message?: string }
					choices?: Array<{ delta?: { content?: string | null; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string | null }>
				}
				try {
					chunk = JSON.parse(data)
				} catch {
					continue
				}
				if (chunk.error) throw new HttpError(500, chunk.error.message ?? 'stream error')
				const choice = chunk.choices?.[0]
				if (!choice) continue
				if (choice.delta?.content) content += choice.delta.content
				for (const tc of choice.delta?.tool_calls ?? []) {
					const index = tc.index ?? 0
					// A new index means earlier calls are complete: run them now so drawing starts early.
					for (const i of [...pending.keys()]) if (i < index) flush(i)
					const p = pending.get(index) ?? { id: '', name: '', args: '' }
					if (tc.id) p.id = tc.id
					if (tc.function?.name) p.name += tc.function.name
					if (tc.function?.arguments) p.args += tc.function.arguments
					pending.set(index, p)
				}
				if (choice.finish_reason) finish = choice.finish_reason
			}
		}
		for (const i of [...pending.keys()].sort((a, b) => a - b)) flush(i)
		return { content, toolCalls: done, finish }
	}
}
