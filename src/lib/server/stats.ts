import 'server-only'
/**
 * Usage totals for a hosted demo, so the owner can see how many people used it, how much each one
 * asked, and roughly what it cost. Kept per day, and per visitor keyed by the anonymous device id
 * from the limits cookie, with the country Vercel derives from the IP (the IP itself is never
 * stored). Only counts, never questions, answers or files. Totals live in the same Redis as the
 * limits and are kept for 400 days.
 */
import { getStore, UpstashStore } from './limits'

export const STAT_FIELDS = ['questions', 'refused', 'inputTokens', 'cachedTokens', 'outputTokens', 'speechChars', 'transcriptions'] as const
export type StatField = (typeof STAT_FIELDS)[number]
/** Times the board was opened; kept per visitor. */
const VISITOR_FIELDS = [...STAT_FIELDS, 'visits'] as const
export type VisitorField = (typeof VISITOR_FIELDS)[number]
export type Counts = Partial<Record<VisitorField, number>>
/** Visitors opened the board; askers sent at least one question on the owner's key. */
export type UniqueSet = 'visitors' | 'askers'

export type DayStats = Record<StatField | UniqueSet, number> & { day: string }
export type VisitorStats = Record<VisitorField, number> & { id: string; first: number; last: number; country?: string }

/** Whose use this was: their device id, and which daily distinct-count it belongs in. */
export interface Who {
	id: string
	country?: string
	unique?: UniqueSet
}

export interface StatsStore {
	add(day: string, fields: Counts, who?: Who): Promise<void>
	read(days: string[]): Promise<DayStats[]>
	/** The most recently active visitors, newest first. */
	visitors(limit: number): Promise<VisitorStats[]>
}

const TTL = 60 * 60 * 24 * 400
/** Visitors remembered in the recent list; older ones fall off. */
const MAX_VISITORS = 5000
const key = (day: string) => `loci:stats:${day}`
const visitorKey = (id: string) => `loci:stats:visitor:${id}`
const RECENT = 'loci:stats:visitors'
const empty = (day: string): DayStats => ({ day, visitors: 0, askers: 0, ...Object.fromEntries(STAT_FIELDS.map((f) => [f, 0])) }) as DayStats
const emptyVisitor = (id: string): VisitorStats => ({ id, first: 0, last: 0, ...Object.fromEntries(VISITOR_FIELDS.map((f) => [f, 0])) }) as VisitorStats

export class UpstashStats implements StatsStore {
	constructor(private redis: UpstashStore, private now = () => Date.now()) {}

	async add(day: string, fields: Counts, who?: Who) {
		const commands: Array<Array<string | number>> = []
		const counts = Object.entries(fields).filter(([, by]) => by)
		for (const [field, by] of counts) commands.push(['HINCRBY', key(day), field, Math.round(by!)])
		if (commands.length) commands.push(['EXPIRE', key(day), TTL])
		if (who?.unique) commands.push(['PFADD', `${key(day)}:${who.unique}`, who.id], ['EXPIRE', `${key(day)}:${who.unique}`, TTL])
		if (who) {
			const k = visitorKey(who.id)
			const now = this.now()
			for (const [field, by] of counts) commands.push(['HINCRBY', k, field, Math.round(by!)])
			commands.push(['HSETNX', k, 'first', now], ['HSET', k, 'last', now, ...(who.country ? ['country', who.country] : [])], ['EXPIRE', k, TTL])
			commands.push(['ZADD', RECENT, now, who.id], ['ZREMRANGEBYRANK', RECENT, 0, -(MAX_VISITORS + 1)])
		}
		if (commands.length) await this.redis.pipeline(commands)
	}

	async read(days: string[]) {
		const results = await this.redis.pipeline(
			days.flatMap((d) => [['HGETALL', key(d)], ['PFCOUNT', `${key(d)}:visitors`], ['PFCOUNT', `${key(d)}:askers`]])
		)
		return days.map((day, i) => {
			const out = empty(day)
			const hash = (results[i * 3] as string[] | null) ?? []
			for (let j = 0; j + 1 < hash.length; j += 2) if ((STAT_FIELDS as readonly string[]).includes(hash[j])) out[hash[j] as StatField] = Number(hash[j + 1]) || 0
			out.visitors = Number(results[i * 3 + 1]) || 0
			out.askers = Number(results[i * 3 + 2]) || 0
			return out
		})
	}

	async visitors(limit: number) {
		const [ids] = (await this.redis.pipeline([['ZREVRANGE', RECENT, 0, limit - 1]])) as [string[] | null]
		if (!ids?.length) return []
		const hashes = await this.redis.pipeline(ids.map((id) => ['HGETALL', visitorKey(id)]))
		return ids.map((id, i) => {
			const out = emptyVisitor(id)
			const hash = (hashes[i] as string[] | null) ?? []
			for (let j = 0; j + 1 < hash.length; j += 2) {
				const [field, value] = [hash[j], hash[j + 1]]
				if (field === 'country') out.country = value
				else if (field === 'first' || field === 'last' || (VISITOR_FIELDS as readonly string[]).includes(field)) out[field as VisitorField | 'first' | 'last'] = Number(value) || 0
			}
			return out
		})
	}
}

/** For local runs: counts in this process's memory. */
export class MemoryStats implements StatsStore {
	private days = new Map<string, { totals: DayStats; sets: Record<UniqueSet, Set<string>> }>()
	private people = new Map<string, VisitorStats>()
	constructor(private now = () => Date.now()) {}
	private of(day: string) {
		let d = this.days.get(day)
		if (!d) this.days.set(day, (d = { totals: empty(day), sets: { visitors: new Set(), askers: new Set() } }))
		return d
	}
	async add(day: string, fields: Counts, who?: Who) {
		const d = this.of(day)
		for (const [field, by] of Object.entries(fields)) if (field in d.totals) d.totals[field as StatField] += by ?? 0
		if (who?.unique) d.sets[who.unique].add(who.id)
		if (who) {
			const v = this.people.get(who.id) ?? { ...emptyVisitor(who.id), first: this.now() }
			for (const [field, by] of Object.entries(fields)) v[field as VisitorField] += by ?? 0
			v.last = this.now()
			if (who.country) v.country = who.country
			this.people.delete(who.id)
			this.people.set(who.id, v)
		}
	}
	async read(days: string[]) {
		return days.map((day) => {
			const d = this.days.get(day)
			return d ? { ...d.totals, visitors: d.sets.visitors.size, askers: d.sets.askers.size } : empty(day)
		})
	}
	async visitors(limit: number) {
		return [...this.people.values()].reverse().slice(0, limit)
	}
}

let stats: StatsStore | null = null
/**
 * Redis only on the production deployment: a local server often has the production Redis
 * credentials (from `vercel env pull`), and its test questions must not count as visitors.
 */
export function getStats(env: NodeJS.ProcessEnv = process.env): StatsStore {
	if (!stats) {
		const store = env.VERCEL_ENV === 'production' ? getStore(env) : null
		stats = store instanceof UpstashStore ? new UpstashStats(store) : new MemoryStats()
	}
	return stats
}

export const today = () => new Date().toISOString().slice(0, 10)

/** The visitor's country as Vercel reports it, e.g. "CA". */
export function countryOf(req: Request): string | undefined {
	const c = req.headers.get('x-vercel-ip-country')?.toUpperCase()
	return c && /^[A-Z]{2}$/.test(c) ? c : undefined
}

/** Count something for today. Never throws: stats must not break a visitor's request. */
export async function recordStats(fields: Counts, who?: Who) {
	try {
		await getStats().add(today(), fields, who)
	} catch (err) {
		console.error('[loci] stats not recorded:', err instanceof Error ? err.message : err)
	}
}

/** The last `count` UTC days, newest first. */
export function lastDays(count: number, now = new Date()): string[] {
	return Array.from({ length: count }, (_, i) => new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10))
}

/** USD prices for the cost estimate. Model prices are per million tokens; unset means "not priced". */
export interface Prices {
	input?: number
	cachedInput?: number
	output?: number
	/** Per million characters of speech (Fish Audio is about $15). */
	speech: number
	/** Per transcription; unset means "not priced". */
	transcription?: number
}

const price = (v: string | undefined) => {
	const n = Number.parseFloat(v ?? '')
	return Number.isFinite(n) && n >= 0 ? n : undefined
}

export function pricesFromEnv(env: NodeJS.ProcessEnv = process.env): Prices {
	const input = price(env.LOCI_PRICE_INPUT)
	return {
		input,
		cachedInput: price(env.LOCI_PRICE_CACHED_INPUT) ?? input,
		output: price(env.LOCI_PRICE_OUTPUT),
		speech: price(env.LOCI_PRICE_SPEECH) ?? 15,
		transcription: price(env.LOCI_PRICE_TRANSCRIBE),
	}
}

/** Estimated spend; `model` is undefined until model prices are configured. */
export function costOf(s: Record<'inputTokens' | 'cachedTokens' | 'outputTokens' | 'speechChars' | 'transcriptions', number>, prices: Prices): { model?: number; voice: number } {
	const model =
		prices.input === undefined || prices.output === undefined
			? undefined
			: ((s.inputTokens - s.cachedTokens) * prices.input + s.cachedTokens * (prices.cachedInput ?? prices.input) + s.outputTokens * prices.output) / 1e6
	const voice = (s.speechChars * prices.speech) / 1e6 + s.transcriptions * (prices.transcription ?? 0)
	return { model, voice }
}

/** Add up several days. Unique counts are summed, so across days they count a returning person once per day. */
export function sumDays(days: DayStats[]): Omit<DayStats, 'day'> {
	const total = empty('')
	for (const d of days) for (const f of [...STAT_FIELDS, 'visitors', 'askers'] as const) total[f] += d[f]
	const { day: _, ...rest } = total
	return rest
}
