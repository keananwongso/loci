import 'server-only'
/**
 * Caps guesses at the stats password: per network and in total, per UTC day. Every attempt is
 * counted up front (atomically, so a burst of parallel guesses can't slip past) and handed back
 * when the password was right, so only wrong guesses use up the allowance.
 */
import { getStore, type CounterStore, type UsageLimits } from './limits'

export const STATS_LOGIN_LIMITS: Pick<UsageLimits, 'perIp' | 'global'> = { perIp: 5, global: 200 }

const keysFor = (ipHash: string) => {
	const k = `loci:${new Date().toISOString().slice(0, 10)}:statslogin:`
	return [`${k}ip:${ipHash}`, `${k}all`]
}

/** Check one password attempt; false means too many wrong guesses today, don't even look. */
export async function statsLoginAttempt(
	ipHash: string,
	check: () => boolean,
	limits = STATS_LOGIN_LIMITS,
	s: CounterStore = getStore(),
): Promise<{ allowed: boolean; ok: boolean }> {
	const keys = keysFor(ipHash)
	const [ip, all] = await s.incr(keys, 60 * 60 * 26)
	if (ip > limits.perIp || all > limits.global) return { allowed: false, ok: false }
	const ok = check()
	if (ok) await s.incr(keys, 60 * 60 * 26, -1)
	return { allowed: true, ok }
}
