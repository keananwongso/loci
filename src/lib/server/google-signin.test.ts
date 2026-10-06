import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ clientId: vi.fn(), signIn: vi.fn() }))
vi.mock('./auth', () => ({ googleClientId: mock.clientId, authClient: async () => ({ auth: { signInWithIdToken: mock.signIn } }) }))
import { GET, POST } from '@/app/api/auth/google/route'

const url = 'https://loci.example/api/auth/google'
const post = (cookie?: string, origin = 'https://loci.example') => new Request(url, { method: 'POST', headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ credential: 'google.id.token' }) })
async function nonce() {
	const res = await GET()
	const raw = res.headers.get('set-cookie')!.match(/loci-google-nonce=([\w-]+)/)![1]
	return { raw, hashed: (await res.json()).nonce as string, setCookie: res.headers.get('set-cookie')! }
}
beforeEach(() => {
	vi.resetAllMocks()
	mock.clientId.mockReturnValue('client.apps.googleusercontent.com')
	mock.signIn.mockResolvedValue({ error: null })
})
describe('Google sign-in', () => {
	it('gives Google the hash of a nonce kept in an HttpOnly cookie', async () => {
		const { raw, hashed, setCookie } = await nonce()
		expect(hashed).toBe(createHash('sha256').update(raw).digest('hex'))
		expect(setCookie).toMatch(/HttpOnly/)
		expect(setCookie).toMatch(/SameSite=Strict/)
	})
	it('verifies the token with the raw nonce and then clears it', async () => {
		const { raw } = await nonce()
		const res = await POST(post(`other=1; loci-google-nonce=${raw}`))
		expect(res.status).toBe(200)
		expect(mock.signIn).toHaveBeenCalledWith({ provider: 'google', token: 'google.id.token', nonce: raw })
		expect(res.headers.get('set-cookie')).toMatch(/loci-google-nonce=; .*Max-Age=0/)
	})
	it('refuses cross-origin posts, missing nonces and rejected tokens', async () => {
		expect((await POST(post('loci-google-nonce=abc', 'https://attacker.example'))).status).toBe(403)
		expect((await POST(post())).status).toBe(400)
		mock.signIn.mockResolvedValue({ error: new Error('nonce mismatch') })
		expect((await POST(post('loci-google-nonce=abc'))).status).toBe(401)
	})
	it('is unavailable until a Google client is configured', async () => {
		mock.clientId.mockReturnValue(null)
		expect((await GET()).status).toBe(503)
		expect((await POST(post('loci-google-nonce=abc'))).status).toBe(503)
		expect(mock.signIn).not.toHaveBeenCalled()
	})
})
