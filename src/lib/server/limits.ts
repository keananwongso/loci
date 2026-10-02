import 'server-only'
/**
 * Free-question limits for a hosted demo running on the owner's API key.
 *
 * Three layers, all per UTC day: a per-device count (signed cookie), a looser per-IP count (so a
 * whole campus network is not locked out but incognito hopping on one connection is), and a global
 * cap that bounds total spend no matter what. Limits are off unless LOCI_DEMO_LIMITS=on.
 * Counts live in Upstash Redis when configured (needed on serverless hosts, where memory does not
 * persist between requests); otherwise in this process's memory.
 */

export interface LimitConfig {
	enabled: boolean
	perDevice: number
	perIp: number
	global: number
}

const int = (v: string | undefined, d: number) => {
	const n = Number.parseInt(v ?? '', 10)
	return Number.isFinite(n) && n >= 0 ? n : d
}

export function limitConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LimitConfig {
	return {
		enabled: env.LOCI_DEMO_LIMITS === 'on',
		perDevice: int(env.LOCI_LIMIT_PER_DEVICE, 5),
		perIp: int(env.LOCI_LIMIT_PER_IP, 20),
		global: int(env.LOCI_LIMIT_GLOBAL, 300),
	}
}

export interface CounterStore {
	/** Increment each key, setting a TTL on first use; returns the new values. */
	incr(keys: string[], ttlSeconds: number): Promise<number[]>
	get(keys: string[]): Promise<number[]>
}

export class MemoryStore implements CounterStore {
	private counts = new Map<string, { n: number; expires: number }>()
	private live(key: string) {
		const c = this.counts.get(key)
		if (c && c.expires < Date.now()) this.counts.delete(key)
		return this.counts.get(key)
	}
	async incr(keys: string[], ttl: number) {
		return keys.map((k) => {
			const c = this.live(k) ?? { n: 0, expires: Date.now() + ttl * 1000 }
			c.n += 1
			this.counts.set(k, c)
			return c.n
		})
	}
	async get(keys: string[]) {
		return keys.map((k) => this.live(k)?.n ?? 0)
	}
}

/** Upstash Redis over its REST API (no client library needed). */
export class UpstashStore implements CounterStore {
	constructor(
		private url: string,
		private token: string,
		private doFetch: typeof fetch = fetch
	) {}
	private async pipeline(commands: Array<Array<string | number>>): Promise<unknown[]> {
		const res = await this.doFetch(`${this.url.replace(/\/$/, '')}/pipeline`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify(commands),
		})
		if (!res.ok) throw new Error(`Rate limit store error ${res.status}`)
		const out = (await res.json()) as Array<{ result?: unknown; error?: string }>
		return out.map((r) => {
			if (r.error) throw new Error(r.error)
			return r.result
		})
	}
	async incr(keys: string[], ttl: number) {
		const commands = keys.flatMap((k) => [
			['INCR', k],
			['EXPIRE', k, ttl, 'NX'],
		])
		const results = await this.pipeline(commands)
		return keys.map((_, i) => Number(results[i * 2]))
	}
	async get(keys: string[]) {
		const results = await this.pipeline([['MGET', ...keys]])
		return ((results[0] as Array<string | null>) ?? []).map((v) => Number(v ?? 0))
	}
}

let store: CounterStore | null = null
export function getStore(env: NodeJS.ProcessEnv = process.env): CounterStore {
	if (!store) {
		const url = env.UPSTASH_REDIS_REST_URL
		const token = env.UPSTASH_REDIS_REST_TOKEN
		store = url && token ? new UpstashStore(url, token) : new MemoryStore()
	}
	return store
}

const day = () => new Date().toISOString().slice(0, 10)
const keysFor = (deviceId: string, ipHash: string) => {
	const d = day()
	return [`loci:${d}:dev:${deviceId}`, `loci:${d}:ip:${ipHash}`, `loci:${d}:all`]
}

export interface Quota {
	limit: number
	remaining: number
}

export type LimitDecision = { ok: true; quota: Quota } | { ok: false; reason: 'device' | 'ip' | 'global'; quota: Quota }

/** Remaining questions for this device today (the number shown in the UI). */
export async function readQuota(config: LimitConfig, deviceId: string, ipHash: string, s = getStore()): Promise<Quota> {
	const [dev, ip, all] = await s.get(keysFor(deviceId, ipHash))
	const remaining = Math.max(0, Math.min(config.perDevice - dev, config.perIp - ip, config.global - all))
	return { limit: config.perDevice, remaining }
}

/** Count one question; refuse it if any layer is over its limit. */
export async function takeQuestion(config: LimitConfig, deviceId: string, ipHash: string, s = getStore()): Promise<LimitDecision> {
	const [dev, ip, all] = await s.get(keysFor(deviceId, ipHash))
	const reason = all >= config.global ? 'global' : dev >= config.perDevice ? 'device' : ip >= config.perIp ? 'ip' : null
	if (reason) return { ok: false, reason, quota: { limit: config.perDevice, remaining: 0 } }
	const [d2, i2, a2] = await s.incr(keysFor(deviceId, ipHash), 60 * 60 * 26)
	const remaining = Math.max(0, Math.min(config.perDevice - d2, config.perIp - i2, config.global - a2))
	return { ok: true, quota: { limit: config.perDevice, remaining } }
}
