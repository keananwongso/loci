import 'server-only'
/**
 * Daily usage totals for a hosted demo, so the owner can see how many people used it and roughly
 * what it cost. Only counts are stored, plus anonymous device ids folded into HyperLogLogs (which
 * estimate how many distinct ids were seen without keeping the ids). Never questions, answers or
 * files. Totals live in the same Redis as the limits and are kept for 400 days.
 */
import { getStore, UpstashStore } from './limits'

export const STAT_FIELDS = ['questions', 'refused', 'inputTokens', 'cachedTokens', 'outputTokens', 'speechChars', 'transcriptions'] as const
export type StatField = (typeof STAT_FIELDS)[number]
/** Visitors opened the board; askers sent at least one question on the owner's key. */
export type UniqueSet = 'visitors' | 'askers'

export type DayStats = Record<StatField | UniqueSet, number> & { day: string }

export interface StatsStore {
	add(day: string, fields: Partial<Record<StatField, number>>, unique?: { set: UniqueSet; id: string }): Promise<void>
	read(days: string[]): Promise<DayStats[]>
}

const TTL = 60 * 60 * 24 * 400
const key = (day: string) => `loci:stats:${day}`
const empty = (day: string): DayStats => ({ day, visitors: 0, askers: 0, ...Object.fromEntries(STAT_FIELDS.map((f) => [f, 0])) }) as DayStats

export class UpstashStats implements StatsStore {
	constructor(private redis: UpstashStore) {}

	async add(day: string, fields: Partial<Record<StatField, number>>, unique?: { set: UniqueSet; id: string }) {
		const commands: Array<Array<string | number>> = []
		for (const [field, by] of Object.entries(fields)) if (by) commands.push(['HINCRBY', key(day), field, Math.round(by)])
		if (commands.length) commands.push(['EXPIRE', key(day), TTL])
		if (unique) commands.push(['PFADD', `${key(day)}:${unique.set}`, unique.id], ['EXPIRE', `${key(day)}:${unique.set}`, TTL])
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
}

/** For local runs: counts in this process's memory. */
export class MemoryStats implements StatsStore {
	private days = new Map<string, { totals: DayStats; sets: Record<UniqueSet, Set<string>> }>()
	private of(day: string) {
		let d = this.days.get(day)
		if (!d) this.days.set(day, (d = { totals: empty(day), sets: { visitors: new Set(), askers: new Set() } }))
		return d
	}
	async add(day: string, fields: Partial<Record<StatField, number>>, unique?: { set: UniqueSet; id: string }) {
		const d = this.of(day)
		for (const [field, by] of Object.entries(fields)) d.totals[field as StatField] += by ?? 0
		if (unique) d.sets[unique.set].add(unique.id)
	}
	async read(days: string[]) {
		return days.map((day) => {
			const d = this.days.get(day)
			return d ? { ...d.totals, visitors: d.sets.visitors.size, askers: d.sets.askers.size } : empty(day)
		})
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

/** Count something for today. Never throws: stats must not break a visitor's request. */
export async function recordStats(fields: Partial<Record<StatField, number>>, unique?: { set: UniqueSet; id: string }) {
	try {
		await getStats().add(today(), fields, unique)
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
export function costOf(s: Omit<DayStats, 'day'>, prices: Prices): { model?: number; voice: number } {
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
