import 'server-only'
/**
 * Anonymous device id for demo limits: a random id in an HttpOnly cookie, signed so it cannot be
 * forged or swapped for someone else's. IPs are only ever stored as salted hashes.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const COOKIE = 'loci_device'
const YEAR = 60 * 60 * 24 * 365

function secret(env: NodeJS.ProcessEnv = process.env) {
	// Without a configured secret, a per-process one still prevents forgery (ids reset on restart).
	return env.LOCI_COOKIE_SECRET || (globalThis.__lociSecret ??= randomBytes(32).toString('hex'))
}
declare global {
	// eslint-disable-next-line no-var
	var __lociSecret: string | undefined
}

const sign = (id: string) => createHmac('sha256', secret()).update(id).digest('base64url').slice(0, 32)

function readCookie(req: Request, name: string) {
	const header = req.headers.get('cookie') ?? ''
	for (const part of header.split(';')) {
		const [k, ...v] = part.trim().split('=')
		if (k === name) {
			try { return decodeURIComponent(v.join('=')) } catch { return undefined }
		}
	}
	return undefined
}

/** The device id from the request, or a new one plus the Set-Cookie header to store it. */
export function deviceFor(req: Request): { id: string; setCookie?: string } {
	const raw = readCookie(req, COOKIE)
	if (raw) {
		const [id, mac] = raw.split('.')
		if (id && mac) {
			const expected = Buffer.from(sign(id))
			const given = Buffer.from(mac)
			if (expected.length === given.length && timingSafeEqual(expected, given)) return { id }
		}
	}
	const id = randomBytes(12).toString('base64url')
	const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : ''
	return { id, setCookie: `${COOKIE}=${id}.${sign(id)}; Path=/; Max-Age=${YEAR}; HttpOnly; SameSite=Lax${secure}` }
}

/** Salted hash of the client IP (first hop of x-forwarded-for on hosts like Vercel). */
export function ipHashFor(req: Request): string {
	const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local'
	return createHash('sha256').update(`${secret()}|${ip}`).digest('base64url').slice(0, 22)
}
