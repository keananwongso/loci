import 'server-only'
import { getStore, type CounterStore, type Quota } from './limits'
import type { Subscription } from './billing'

export type PaidKind = 'question' | 'speech' | 'transcribe'
const positive = (value: string | undefined, fallback: number) => {
	const number = Number(value)
	return /^\d+$/.test(value ?? '') && Number.isSafeInteger(number) ? number : fallback
}
export function paidLimits(kind: PaidKind) {
	const monthly = { question: positive(process.env.LOCI_PRO_QUESTIONS, 200), speech: positive(process.env.LOCI_PRO_SPEECH_CHARS, 150000), transcribe: positive(process.env.LOCI_PRO_TRANSCRIPTIONS, 600) }[kind]
	const daily = { question: positive(process.env.LOCI_PRO_QUESTIONS_DAILY, 20), speech: positive(process.env.LOCI_PRO_SPEECH_CHARS_DAILY, 20000), transcribe: positive(process.env.LOCI_PRO_TRANSCRIPTIONS_DAILY, 60) }[kind]
	const global = { question: positive(process.env.LOCI_PRO_QUESTIONS_GLOBAL_DAILY, 2000), speech: positive(process.env.LOCI_PRO_SPEECH_CHARS_GLOBAL_DAILY, 1000000), transcribe: positive(process.env.LOCI_PRO_TRANSCRIPTIONS_GLOBAL_DAILY, 6000) }[kind]
	return { monthly, daily, global }
}
const keys = (s: Subscription, kind: PaidKind) => {
	const day = new Date().toISOString().slice(0, 10)
	return [`loci:pro:${s.user_id}:${s.period_start}:${kind}`, `loci:pro:${day}:${s.user_id}:${kind}`, `loci:pro:${day}:all:${kind}`]
}

/** A monthly account allowance plus separate daily account and paid-service spend caps. */
export async function paidUsage(s: Subscription, kind: PaidKind, amount: number, store: CounterStore = getStore()): Promise<{ ok: boolean; reason?: string; quota: Quota }> {
	const { monthly, daily, global } = paidLimits(kind)
	const ttl = Math.max(86400, Math.ceil(s.period_end - Date.now() / 1000) + 172800)
	const result = await store.reserve(keys(s, kind), [monthly, daily, global], amount, ttl)
	const reason = result.reason === 1 ? 'global' : result.reason === 2 ? 'subscription' : result.reason === 3 ? 'daily' : undefined
	return { ok: !result.reason, reason, quota: { limit: monthly, remaining: Math.max(0, monthly - result.counts[0]) } }
}
export async function paidQuota(s: Subscription, store: CounterStore = getStore()): Promise<Quota> {
	const limit = paidLimits('question').monthly
	const counts = await store.get(keys(s, 'question'))
	return { limit, remaining: Math.max(0, limit - counts[0]) }
}
