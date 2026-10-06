import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryStore } from './limits'

const state = vi.hoisted(() => ({ store: null as unknown, account: null as import('./billing').Subscription | null, userId: null as string | null, signedIn: false, unavailable: false, tutor: vi.fn(), speech: vi.fn(), transcribe: vi.fn() }))
vi.mock('./auth', () => ({ authConfigured: () => true, currentUser: async () => state.signedIn ? { id: 'free-user' } : null }))
vi.mock('./billing', async (original) => ({
	meterId: (await original<typeof import('./billing')>()).meterId,
	viewer: async () => ({ paid: state.account, userId: state.account?.user_id ?? state.userId ?? (state.signedIn ? 'free-user' : null) }),
}))
vi.mock('./limits', async (original) => {
	const actual = await original<typeof import('./limits')>()
	const store = () => { if (state.unavailable) throw new Error('Redis unavailable'); return state.store as MemoryStore }
	return {
		...actual,
		getStore: store,
		takeQuestion: (...args: Parameters<typeof actual.takeQuestion>) => actual.takeQuestion(args[0], args[1], args[2], store()),
		takeUsage: (...args: Parameters<typeof actual.takeUsage>) => actual.takeUsage(args[0], args[1], args[2], args[3], args[4], store()),
		readQuota: (...args: Parameters<typeof actual.readQuota>) => actual.readQuota(args[0], args[1], args[2], store()),
	}
})
vi.mock('@/lib/providers', () => ({
	getProvider: () => ({ name: 'test', model: 'test', isConfigured: () => true, run: state.tutor }),
	providerForUserKey: () => { throw new Error('Unsupported provider') },
}))
vi.mock('@/lib/voice/fish', async (original) => ({
	...await original<typeof import('@/lib/voice/fish')>(),
	fishSpeech: state.speech,
	fishTranscribe: state.transcribe,
}))

import { GET as tutorInfo, POST as tutor } from '@/app/api/tutor/route'
import { POST as speech } from '@/app/api/speech/route'
import { POST as transcribe } from '@/app/api/transcribe/route'
import { adminRefusal } from './admin'
import { getStats, today } from './stats'

const question = { question: 'Explain the gradient', board: { viewport: { x: 0, y: 0, w: 800, h: 600 }, selectedIds: [], objects: [] }, images: [], history: [], turn: 0 }
const req = (path: string, body: string, headers: Record<string, string> = {}) => new Request(`https://loci.example/api/${path}`, {
	method: 'POST', body, headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...headers },
})

beforeEach(() => {
	state.store = new MemoryStore()
	state.unavailable = false
	state.account = null
	state.userId = null
	state.signedIn = false
	vi.clearAllMocks()
	vi.stubEnv('NODE_ENV', 'production')
	vi.stubEnv('LOCI_DEMO_LIMITS', 'on')
	vi.stubEnv('LOCI_COOKIE_SECRET', 'test-only-cookie-secret')
	vi.stubEnv('LOCI_LIMIT_PER_DEVICE', '2')
	vi.stubEnv('LOCI_LIMIT_PER_IP', '3')
	vi.stubEnv('LOCI_LIMIT_GLOBAL', '5')
	vi.stubEnv('LOCI_LIMIT_SPEECH_CHARS_PER_DEVICE', '5')
	vi.stubEnv('LOCI_LIMIT_TRANSCRIBE_PER_DEVICE', '1')
	vi.stubEnv('FISH_API_KEY', 'test-only-key')
	state.tutor.mockResolvedValue(undefined)
	state.speech.mockImplementation(async () => new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); c.close() } }))
	state.transcribe.mockResolvedValue('a test question')
})
afterEach(() => vi.unstubAllEnvs())

describe('paid public endpoints', () => {
	it('distinguishes a signed-in free user from an anonymous visitor independently of billing', async () => {
		state.signedIn = true
		vi.stubEnv('LOCI_DEMO_LIMITS', 'off')
		expect(await (await tutorInfo(new Request('https://loci.example/api/tutor'))).json()).toMatchObject({ accounts: true, signedIn: true, pro: false })
		state.signedIn = false
		expect(await (await tutorInfo(new Request('https://loci.example/api/tutor'))).json()).toMatchObject({ signedIn: false, pro: false })
	})

	it('stops counting cookie-less board opens from one network past the visit cap', async () => {
		const [before] = await getStats().read([today()])
		const initialVisitors = before.visitors
		for (let i = 0; i < 120; i++) await tutorInfo(new Request('https://loci.example/api/tutor', { headers: { 'x-forwarded-for': '198.51.100.4' } }))
		const [day] = await getStats().read([today()])
		expect(day.visitors - initialVisitors).toBe(100)
	})

	it('limits concurrent tutor requests per device before calling the provider', async () => {
		const first = await tutor(req('tutor', JSON.stringify(question)))
		expect(first.status).toBe(200)
		const cookie = first.headers.get('set-cookie')!.split(';')[0]
		const results = await Promise.all(Array.from({ length: 20 }, () => tutor(req('tutor', JSON.stringify(question), { cookie }))))
		expect(results.filter(r => r.status === 200)).toHaveLength(1)
		expect(results.filter(r => r.status === 429)).toHaveLength(19)
		expect(state.tutor).toHaveBeenCalledTimes(2)
	})

	it('blocks cookie resets at the network cap and other networks at the global cap', async () => {
		for (let i = 0; i < 3; i++) expect((await tutor(req('tutor', JSON.stringify(question)))).status).toBe(200)
		expect((await tutor(req('tutor', JSON.stringify(question)))).status).toBe(429)
		for (let i = 0; i < 2; i++) expect((await tutor(req('tutor', JSON.stringify(question), { 'x-forwarded-for': '203.0.113.8' }))).status).toBe(200)
		const blocked = await tutor(req('tutor', JSON.stringify(question), { 'x-forwarded-for': '203.0.113.9' }))
		expect(await blocked.json()).toMatchObject({ limitReached: 'global' })
		expect(state.tutor).toHaveBeenCalledTimes(5)
	})

	it('enforces voice character and transcription limits before Fish is called', async () => {
		const first = await speech(req('speech', JSON.stringify({ text: 'Hello' })))
		const cookie = first.headers.get('set-cookie')!.split(';')[0]
		expect((await speech(req('speech', JSON.stringify({ text: '!' }), { cookie }))).status).toBe(429)
		expect(state.speech).toHaveBeenCalledTimes(1)
		expect((await transcribe(req('transcribe', 'audio', { cookie, 'content-type': 'audio/webm' }))).status).toBe(200)
		expect((await transcribe(req('transcribe', 'audio', { cookie, 'content-type': 'audio/webm' }))).status).toBe(429)
		expect(state.transcribe).toHaveBeenCalledTimes(1)
	})

	it('fails closed when the counter store is unavailable', async () => {
		state.unavailable = true
		expect((await tutor(req('tutor', JSON.stringify(question)))).status).toBe(503)
		expect((await speech(req('speech', JSON.stringify({ text: 'Hi' })))).status).toBe(429)
		expect((await transcribe(req('transcribe', 'audio'))).status).toBe(429)
		expect(state.tutor).not.toHaveBeenCalled()
		expect(state.speech).not.toHaveBeenCalled()
		expect(state.transcribe).not.toHaveBeenCalled()
	})

	it('rejects invalid, cross-origin and oversized requests before paid calls', async () => {
		expect((await tutor(req('tutor', '{}'))).status).toBe(400)
		expect((await speech(req('speech', JSON.stringify({ text: 'Hi' }), { origin: 'https://evil.example' }))).status).toBe(403)
		expect((await speech(req('speech', 'x'.repeat(20_000)))).status).toBe(413)
		expect((await transcribe(req('transcribe', 'x'.repeat(2_000_001)))).status).toBe(413)
		expect(state.tutor).not.toHaveBeenCalled()
		expect(state.speech).not.toHaveBeenCalled()
		expect(state.transcribe).not.toHaveBeenCalled()
	})

	it('keeps local admin endpoints disabled in production even with spoofed headers', () => {
		expect(adminRefusal(new Request('http://localhost/api/admin/pack', { headers: { host: 'localhost', 'x-loci-admin': '1' } }))?.status).toBe(404)
	})
	it('uses verified account quotas across browsers and gates paid speech before the provider', async () => {
		state.account = { user_id: 'verified-account', stripe_customer_id: 'cus_test', stripe_subscription_id: 'sub_test', status: 'active', period_start: Math.floor(Date.now() / 1000) - 100, period_end: Math.floor(Date.now() / 1000) + 86400, cancel_at_period_end: false }
		vi.stubEnv('LOCI_PRO_QUESTIONS', '4')
		vi.stubEnv('LOCI_PRO_SPEECH_CHARS', '5')
		const info = await tutorInfo(new Request('https://loci.example/api/tutor'))
		expect(await info.json()).toMatchObject({ pro: true, quota: { limit: 4, remaining: 4 } })
		for (let i = 0; i < 4; i++) expect((await tutor(req('tutor', JSON.stringify(question)))).status).toBe(200)
		const blocked = await tutor(req('tutor', JSON.stringify(question)))
		expect(blocked.status).toBe(429)
		expect(await blocked.json()).toMatchObject({ limitReached: 'subscription' })
		expect(state.tutor).toHaveBeenCalledTimes(4)
		expect((await speech(req('speech', JSON.stringify({ text: 'Hello' })))).status).toBe(200)
		expect((await speech(req('speech', JSON.stringify({ text: '!' })))).status).toBe(429)
		expect(state.speech).toHaveBeenCalledTimes(1)
	})

	it('counts a signed-in free account across browsers and networks', async () => {
		state.userId = 'free-account'
		// Each request is a new browser (no cookie) on a different network.
		for (const ip of ['198.51.100.1', '198.51.100.2']) expect((await tutor(req('tutor', JSON.stringify(question), { 'x-forwarded-for': ip }))).status).toBe(200)
		const blocked = await tutor(req('tutor', JSON.stringify(question), { 'x-forwarded-for': '198.51.100.3' }))
		expect(blocked.status).toBe(429)
		expect(await blocked.json()).toMatchObject({ limitReached: 'device' })
		expect(state.tutor).toHaveBeenCalledTimes(2)
	})
})


describe('topic planning endpoint', () => {
 it('uses the existing allowance and streams a validated plan without canvas tools', async () => {
  state.tutor.mockImplementationOnce(async (input, session) => {
   expect(input.tools.map((t: { name: string }) => t.name)).toEqual(['plan_lesson'])
   session.handle('plan_lesson', { title: 'Eigenvectors', sections: [{ title: 'Intuition', objective: 'Understand direction preservation', pageIds: ['notes-p1'] }], gaps: [] })
  })
  const planRequest = { ...question, planning: { topic: 'Eigenvectors', pages: [{ id: 'notes-p1', sourceId: 'notes', name: 'notes.pdf', role: 'notes', page: 1, text: 'Eigenvectors preserve direction.', truncated: false }] } }
  const response = await tutor(req('tutor', JSON.stringify(planRequest)))
  expect(response.status).toBe(200)
  const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line))
  expect(events).toEqual([{ type: 'plan', plan: { title: 'Eigenvectors', sections: [{ title: 'Intuition', objective: 'Understand direction preservation', pageIds: ['notes-p1'] }], gaps: [] } }, { type: 'done' }])
  expect(response.headers.get('X-Loci-Quota-Remaining')).not.toBeNull()
 })
 it('reports a provider that never returns an outline', async () => {
  const planRequest = { ...question, planning: { topic: 'Eigenvectors', pages: [{ id: 'notes-p1', sourceId: 'notes', name: 'notes.pdf', role: 'notes', page: 1, text: 'Eigenvectors preserve direction.', truncated: false }] } }
  const response = await tutor(req('tutor', JSON.stringify(planRequest)))
  expect(await response.text()).toContain('did not return a lesson outline')
 })
})
