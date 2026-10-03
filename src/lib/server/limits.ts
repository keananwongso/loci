import 'server-only'
/**
 * Free-use limits for a hosted demo running on the owner's API keys.
 *
 * Three layers, all per UTC day: a per-device count (signed cookie), a looser per-IP count (so a
 * whole campus network is not locked out but incognito hopping on one connection is), and a global
 * cap that bounds total spend no matter what. Questions are counted one by one; Fish Audio speech
 * is counted in characters (what Fish bills) and transcription in requests, so the voice endpoints
 * can't be used to spend the owner's credits either. Limits are off unless LOCI_DEMO_LIMITS=on.
 * Counts live in Upstash Redis when configured (needed on serverless hosts, where memory does not
 * persist between requests); otherwise in this process's memory.
 */

export interface UsageLimits {
	perDevice: number
	perIp: number
	global: number
}

export interface LimitConfig extends UsageLimits {
	enabled: boolean
	/** Characters of Fish Audio speech. */
	speech: UsageLimits
	/** Fish Audio transcriptions. */
	transcribe: UsageLimits
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
		speech: {
			perDevice: int(env.LOCI_LIMIT_SPEECH_CHARS_PER_DEVICE, 8000),
			perIp: int(env.LOCI_LIMIT_SPEECH_CHARS_PER_IP, 32000),
			global: int(env.LOCI_LIMIT_SPEECH_CHARS_GLOBAL, 400000),
		},
		transcribe: {
			perDevice: int(env.LOCI_LIMIT_TRANSCRIBE_PER_DEVICE, 15),
			perIp: int(env.LOCI_LIMIT_TRANSCRIBE_PER_IP, 60),
			global: int(env.LOCI_LIMIT_TRANSCRIBE_GLOBAL, 1500),
		},
	}
}

export interface CounterStore {
	/** Add `by` to each key, setting a TTL on first use; returns the new values. */
	incr(keys: string[], ttlSeconds: number, by?: number): Promise<number[]>
	get(keys: string[]): Promise<number[]>
}

export class MemoryStore implements CounterStore {
	private counts = new Map<string, { n: number; expires: number }>()
	private live(key: string) {
		const c = this.counts.get(key)
		if (c && c.expires < Date.now()) this.counts.delete(key)
		return this.counts.get(key)
	}
	async incr(keys: string[], ttl: number, by = 1) {
		return keys.map((k) => {
			const c = this.live(k) ?? { n: 0, expires: Date.now() + ttl * 1000 }
			c.n += by
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
	async incr(keys: string[], ttl: number, by = 1) {
		const commands = keys.flatMap((k) => [
			['INCRBY', k, by],
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
export type UsageKind = 'question' | 'speech' | 'transcribe'
const keysFor = (kind: UsageKind, deviceId: string, ipHash: string) => {
	// Questions keep their original keys, so counts survive this change mid-day.
	const k = `loci:${day()}:${kind === 'question' ? '' : `${kind}:`}`
	return [`${k}dev:${deviceId}`, `${k}ip:${ipHash}`, `${k}all`]
}

export interface Quota {
	limit: number
	remaining: number
}

export type LimitDecision = { ok: true; quota: Quota } | { ok: false; reason: 'device' | 'ip' | 'global'; quota: Quota }

const remainingOf = (l: UsageLimits, [dev, ip, all]: number[]) => Math.max(0, Math.min(l.perDevice - dev, l.perIp - ip, l.global - all))

/** Remaining questions for this device today (the number shown in the UI). */
export async function readQuota(config: LimitConfig, deviceId: string, ipHash: string, s = getStore()): Promise<Quota> {
	return { limit: config.perDevice, remaining: remainingOf(config, await s.get(keysFor('question', deviceId, ipHash))) }
}

/** Count `amount` of one kind of use; refuse it if it would take any layer over its limit. */
export async function takeUsage(
	kind: UsageKind,
	limits: UsageLimits,
	deviceId: string,
	ipHash: string,
	amount = 1,
	s = getStore()
): Promise<LimitDecision> {
	const keys = keysFor(kind, deviceId, ipHash)
	const [dev, ip, all] = await s.get(keys)
	const reason = all + amount > limits.global ? 'global' : dev + amount > limits.perDevice ? 'device' : ip + amount > limits.perIp ? 'ip' : null
	if (reason) return { ok: false, reason, quota: { limit: limits.perDevice, remaining: remainingOf(limits, [dev, ip, all]) } }
	const counts = await s.incr(keys, 60 * 60 * 26, amount)
	return { ok: true, quota: { limit: limits.perDevice, remaining: remainingOf(limits, counts) } }
}

/** Count one question; refuse it if any layer is over its limit. */
export function takeQuestion(config: LimitConfig, deviceId: string, ipHash: string, s = getStore()): Promise<LimitDecision> {
	return takeUsage('question', config, deviceId, ipHash, 1, s)
}
