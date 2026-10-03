import { describe, expect, it } from 'vitest'
import { OpenAICompatibleProvider } from './openai-compatible'
import { getProvider } from './index'
import { ActionSession } from '@/lib/tutor/session'
import { getToolDefinitions } from '@/lib/actions/tools'
import { SYSTEM_PROMPT, buildTurnText, NO_VISION_NOTE } from '@/lib/tutor/prompt'
import type { TutorEvent, TutorRequest } from '@/lib/tutor/types'

const request: TutorRequest = {
	question: 'what is u?',
	turn: 1,
	history: [],
	images: [{ label: 'page', mediaType: 'image/jpeg', data: 'aGVsbG8=', width: 10, height: 10 }],
	board: {
		viewport: { x: 0, y: 0, w: 1000, h: 800 },
		selectedIds: ['notes-p1'],
		objects: [
			{
				id: 'notes-p1',
				type: 'pdf',
				author: 'user',
				bounds: { x: 0, y: 0, w: 600, h: 800 },
				material: { kind: 'pdf', name: 'notes.pdf', page: 1, pageCount: 1, textItems: [{ t: 'D_u f = ∇f · u', b: [0.1, 0.3, 0.4, 0.03] }] },
			},
		],
	},
}

/** OpenAI-style SSE: each chunk is one `data:` line. */
const sse = (chunks: object[]) => chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
const delta = (d: object, finish: string | null = null) => ({ choices: [{ index: 0, delta: d, finish_reason: finish }] })

function fakeFetch(responses: Array<{ status: number; body: string }>, calls: Array<{ url: string; body: any; headers: Headers }>) {
	return (async (url: string, init: RequestInit) => {
		calls.push({ url, body: JSON.parse(String(init.body)), headers: new Headers(init.headers) })
		const r = responses.shift()!
		return new Response(r.body, { status: r.status, headers: { 'content-type': 'text/event-stream' } })
	}) as unknown as typeof fetch
}

async function run(provider: OpenAICompatibleProvider) {
	const events: TutorEvent[] = []
	const emit = (e: TutorEvent) => events.push(e)
	await provider.run(
		{ system: SYSTEM_PROMPT, tools: getToolDefinitions(), request, turnText: buildTurnText(request) },
		new ActionSession(request.board, emit),
		emit,
		new AbortController().signal
	)
	return events
}

describe('OpenAICompatibleProvider', () => {
	it('keeps going after a spoken lead-in, and stops once the answer ends on a question', async () => {
		const calls: Array<{ url: string; body: any; headers: Headers }> = []
		const say = (id: string, index: number, text: string) =>
			delta({ tool_calls: [{ index, id, type: 'function', function: { name: 'say', arguments: JSON.stringify({ text }) } }] })
		const round1 = sse([say('a', 0, "It's a picture about two arrows. Let me draw it beside your notes."), delta({}, 'tool_calls')])
		const round2 = sse([
			delta({ tool_calls: [{ index: 0, id: 'b', type: 'function', function: { name: 'highlight', arguments: '{"target":"notes-p1","text":"∇f · u"}' } }] }),
			say('c', 1, 'Which way does u point here?'),
			delta({}, 'tool_calls'),
		])
		const round3 = sse([say('d', 0, 'This should never be asked for.'), delta({}, 'tool_calls')])
		const provider = new OpenAICompatibleProvider({
			name: 'deepseek',
			baseUrl: 'https://api.example.com/v1',
			apiKey: 'sk-test',
			model: 'deepseek-flash',
			vision: 'auto',
			fetch: fakeFetch([{ status: 200, body: round1 }, { status: 200, body: round2 }, { status: 200, body: round3 }], calls),
		})
		const events = await run(provider)
		const kinds = events.filter((e) => e.type !== 'thought').map((e) => (e.type === 'action' ? `action:${e.action.type}` : e.type))
		expect(kinds).toEqual(['say', 'action:highlight', 'say'])
		expect(calls).toHaveLength(2)
	})

	it('assembles streamed tool calls, runs them, and returns results as tool messages', async () => {
		const calls: Array<{ url: string; body: any; headers: Headers }> = []
		const round1 = sse([
			delta({ tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'say', arguments: '' } }] }),
			delta({ tool_calls: [{ index: 0, function: { arguments: '{"text":"Look ' } }] }),
			delta({ tool_calls: [{ index: 0, function: { arguments: 'here."}' } }] }),
			delta({ tool_calls: [{ index: 1, id: 'c2', type: 'function', function: { name: 'highlight', arguments: '{"target":"notes-p1","text":"∇f · u"}' } }] }),
			delta({}, 'tool_calls'),
		])
		const round2 = sse([delta({ content: 'Does that help?' }), delta({}, 'stop')])
		const provider = new OpenAICompatibleProvider({
			name: 'deepseek',
			baseUrl: 'https://api.example.com/v1/',
			apiKey: 'sk-test',
			model: 'deepseek-flash',
			vision: 'auto',
			fetch: fakeFetch([{ status: 200, body: round1 }, { status: 200, body: round2 }], calls),
		})
		const events = await run(provider)

		expect(calls[0].url).toBe('https://api.example.com/v1/chat/completions')
		expect(calls[0].headers.get('authorization')).toBe('Bearer sk-test')
		expect(calls[0].body.tools[0].type).toBe('function')
		expect(JSON.stringify(calls[0].body.tools)).not.toContain('"pattern"')
		const user = calls[0].body.messages.at(-1)
		expect(user.content.some((p: any) => p.type === 'image_url' && p.image_url.url.startsWith('data:image/jpeg;base64,'))).toBe(true)

		const second = calls[1].body.messages
		expect(second.at(-3).tool_calls.map((t: any) => t.id)).toEqual(['c1', 'c2'])
		expect(second.at(-2)).toMatchObject({ role: 'tool', tool_call_id: 'c1' })
		expect(second.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'c2' })

		const kinds = events.map((e) => (e.type === 'action' ? `action:${e.action.type}` : e.type))
		expect(kinds).toEqual(['say', 'thought', 'action:highlight', 'say'])
		// The thought is read from the call while it streams, before the highlight is drawn.
		expect(events[1]).toEqual({ type: 'thought', text: 'finding “∇f · u”' })
	})

	it('falls back to text-only when the model rejects images', async () => {
		const calls: Array<{ url: string; body: any; headers: Headers }> = []
		const provider = new OpenAICompatibleProvider({
			name: 'custom',
			baseUrl: 'http://localhost:11434/v1',
			model: 'text-only-model-for-test',
			vision: 'auto',
			fetch: fakeFetch(
				[
					{ status: 400, body: '{"error":{"message":"image input is not supported"}}' },
					{ status: 200, body: sse([delta({ content: 'Text only answer.' }), delta({}, 'stop')]) },
				],
				calls
			),
		})
		const events = await run(provider)
		expect(calls).toHaveLength(2)
		expect(typeof calls[1].body.messages.at(-1).content).toBe('string')
		expect(calls[1].body.messages.at(-1).content).toContain(NO_VISION_NOTE)
		expect(events.some((e) => e.type === 'status')).toBe(true)
		expect(events.some((e) => e.type === 'say' && e.text === 'Text only answer.')).toBe(true)
	})

	it('turns DeepSeek thinking off, and sends any reasoning back with the tool calls', async () => {
		const calls: Array<{ url: string; body: any; headers: Headers }> = []
		const round1 = sse([
			delta({ reasoning_content: 'They want u.' }),
			delta({ tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'say', arguments: '{"text":"Look here."}' } }] }),
			delta({}, 'tool_calls'),
		])
		const round2 = sse([delta({ content: '' }), delta({}, 'stop')])
		const fetch = fakeFetch([{ status: 200, body: round1 }, { status: 200, body: round2 }], calls)
		const preset = getProvider({ DEEPSEEK_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv) as OpenAICompatibleProvider
		const provider = new OpenAICompatibleProvider({ ...(preset as any).config, fetch })
		await run(provider)
		expect(calls[0].body.thinking).toEqual({ type: 'disabled' })
		expect(calls[1].body.messages.at(-2)).toMatchObject({ role: 'assistant', reasoning_content: 'They want u.' })

		const on = getProvider({ DEEPSEEK_API_KEY: 'k', LOCI_THINKING: 'on' } as unknown as NodeJS.ProcessEnv) as any
		expect(on.config.extraBody).toEqual({ thinking: { type: 'enabled' } })
		const other = getProvider({ OPENROUTER_API_KEY: 'k', LOCI_MODEL: 'x/y' } as unknown as NodeJS.ProcessEnv) as any
		expect(other.config.extraBody).toBeUndefined()
	})

	it('explains common failures', () => {
		const p = new OpenAICompatibleProvider({ name: 'openrouter', baseUrl: 'x', model: 'm', vision: 'auto' })
		expect(p.isConfigured()).toBe(true)
		const missing = new OpenAICompatibleProvider({ name: 'openrouter', baseUrl: 'x', vision: 'auto', keyEnv: 'OPENROUTER_API_KEY' })
		expect(missing.isConfigured()).toBe(false)
		expect(missing.setupHint).toContain('LOCI_MODEL')
		expect(missing.setupHint).toContain('OPENROUTER_API_KEY')
	})
})

describe('getProvider', () => {
	it('picks the provider from whichever key is set', () => {
		expect(getProvider({ DEEPSEEK_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv).name).toBe('deepseek')
		expect(getProvider({ DEEPSEEK_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv).model).toBe('deepseek-flash')
		expect(getProvider({ OPENROUTER_API_KEY: 'k', LOCI_MODEL: 'x/y' } as unknown as NodeJS.ProcessEnv).name).toBe('openrouter')
		expect(getProvider({ ANTHROPIC_API_KEY: 'k', OPENROUTER_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv).name).toBe('anthropic')
		expect(getProvider({ LOCI_PROVIDER: 'ollama', LOCI_MODEL: 'qwen' } as unknown as NodeJS.ProcessEnv).isConfigured()).toBe(true)
		expect(() => getProvider({ LOCI_PROVIDER: 'nope' } as unknown as NodeJS.ProcessEnv)).toThrow(/Unknown/)
		// The hint says which provider was picked and why, so a stray key is easy to spot.
		const stray = getProvider({ OPENROUTER_API_KEY: 'k', DEEPSEEK_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv)
		expect(stray.setupHint).toContain('openrouter (found OPENROUTER_API_KEY)')
		expect(stray.setupHint).toContain('LOCI_PROVIDER')
	})
})
