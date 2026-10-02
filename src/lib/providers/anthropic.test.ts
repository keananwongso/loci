import { describe, expect, it } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { AnthropicProvider } from './anthropic'
import { ActionSession } from '@/lib/tutor/session'
import { getToolDefinitions } from '@/lib/actions/tools'
import { SYSTEM_PROMPT, buildTurnText } from '@/lib/tutor/prompt'
import type { TutorEvent, TutorRequest } from '@/lib/tutor/types'

type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown }

/** Server-sent events for one streamed Messages API response. */
function sse(blocks: Block[], stopReason: string): string {
	const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
	let out = ev('message_start', {
		message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } },
	})
	blocks.forEach((b, index) => {
		if (b.type === 'text') {
			out += ev('content_block_start', { index, content_block: { type: 'text', text: '' } })
			out += ev('content_block_delta', { index, delta: { type: 'text_delta', text: b.text } })
		} else {
			out += ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } })
			out += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } })
		}
		out += ev('content_block_stop', { index })
	})
	out += ev('message_delta', { delta: { stop_reason: stopReason }, usage: { output_tokens: 20 } })
	out += ev('message_stop', {})
	return out
}

function fakeClient(responses: string[], requests: Array<{ body: any; headers: Headers }>) {
	return new Anthropic({
		apiKey: 'test-key',
		maxRetries: 0,
		fetch: (async (_url: string, init: RequestInit) => {
			requests.push({ body: JSON.parse(String(init.body)), headers: new Headers(init.headers) })
			const body = responses.shift()
			if (!body) throw new Error('no more responses')
			return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
		}) as typeof fetch,
	})
}

const request: TutorRequest = {
	question: 'what is u geometrically?',
	turn: 1,
	history: [{ question: 'earlier', answer: 'earlier answer', actions: ['write_equation eq-1: x'] }],
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

describe('AnthropicProvider', () => {
	it('runs the tool loop, streams validated actions, and feeds errors back to the model', async () => {
		const requests: Array<{ body: any; headers: Headers }> = []
		const client = fakeClient(
			[
				sse(
					[
						{ type: 'tool_use', id: 't1', name: 'say', input: { text: 'Look here.' } },
						{ type: 'tool_use', id: 't2', name: 'highlight', input: { id: 'hl-u', target: 'notes-p1', text: '∇f · u' } },
						{ type: 'tool_use', id: 't3', name: 'write_equation', input: { latex: '\\frac{1}{', position: { relativeTo: 'hl-u', placement: 'right' } } },
					],
					'tool_use'
				),
				sse(
					[
						{ type: 'tool_use', id: 't4', name: 'write_equation', input: { latex: '\\nabla f \\cdot u', position: { relativeTo: 'hl-u', placement: 'right' } } },
						{ type: 'tool_use', id: 't5', name: 'say', input: { text: 'What happens if $u$ flips?' } },
					],
					'tool_use'
				),
				sse([{ type: 'text', text: '' }], 'end_turn'),
			],
			requests
		)

		const events: TutorEvent[] = []
		const emit = (e: TutorEvent) => events.push(e)
		const provider = new AnthropicProvider({ makeClient: () => client })
		await provider.run(
			{ system: SYSTEM_PROMPT, tools: getToolDefinitions(), request, turnText: buildTurnText(request) },
			new ActionSession(request.board, emit),
			emit,
			new AbortController().signal
		)

		// Request shape
		const first = requests[0]
		expect(first.body.model).toBe('claude-opus-5-5')
		expect(first.body.tools).toHaveLength(getToolDefinitions().length)
		expect(first.body.system[0].cache_control).toEqual({ type: 'ephemeral' })
		expect(first.body.fallbacks).toBe('default')
		expect(first.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01')
		expect(first.body.messages[0]).toEqual({ role: 'user', content: 'earlier' })
		const current = first.body.messages.at(-1).content
		expect(current.some((b: any) => b.type === 'image')).toBe(true)
		expect(current.at(-1).text).toContain('Student: what is u geometrically?')
		expect(JSON.stringify(first.body)).not.toContain('test-key')

		// Loop: results for every tool_use are returned in one user message, errors flagged
		const second = requests[1].body.messages
		const results = second.at(-1).content
		expect(results.map((r: any) => r.tool_use_id)).toEqual(['t1', 't2', 't3'])
		expect(results[2].is_error).toBe(true)
		expect(results[2].content).toMatch(/LaTeX/)
		expect(second.at(-2).role).toBe('assistant')

		// Events reaching the browser
		const kinds = events.map((e) => (e.type === 'action' ? `action:${e.action.type}` : e.type))
		expect(kinds).toEqual(['say', 'action:highlight', 'rejected', 'action:write_equation', 'say'])
		expect(requests).toHaveLength(3)
	})
})
