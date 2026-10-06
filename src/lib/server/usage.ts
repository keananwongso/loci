import 'server-only'
/**
 * Guards a hosted-demo endpoint that spends the owner's credits. When limits are on, counts this
 * request's use against the visitor's device, network and the global daily cap, and refuses it with
 * a 429 once a cap is reached. The client treats a refusal as "use the browser's voice instead".
 */
import { deviceFor, ipHashFor } from './device'
import { meterId, viewer } from './billing'
import { paidUsage } from './paid-usage'
import { limitConfigFromEnv, takeUsage } from './limits'

export async function guardUsage(req: Request, kind: 'speech' | 'transcribe', amount: number): Promise<{ refused?: Response; cookie?: string }> {
	const config = limitConfigFromEnv()
	if (!config.enabled) return {}
	const device = deviceFor(req)
	let userId: string | null
	try {
		const who = await viewer()
		userId = who.userId
		const account = who.paid
		if (account) {
			const usage = await paidUsage(account, kind, amount)
			return usage.ok ? { cookie: device.setCookie } : { refused: Response.json({ error: 'Your included voice allowance is used up. Browser voice is still available.', limitReached: usage.reason }, { status: 429 }) }
		}
	} catch { return { refused: Response.json({ error: 'Could not check voice allowance.', limitReached: 'store' }, { status: 503 }) } }
	const decision = await Promise.resolve().then(() => takeUsage(kind, config[kind], meterId(device.id, userId), ipHashFor(req), amount)).catch((err) => {
		// A broken counter store must not turn into unlimited spend.
		console.error(`[loci] ${kind} limit check failed:`, err instanceof Error ? err.message : err)
		return null
	})
	if (decision?.ok) return { cookie: device.setCookie }
	const res = Response.json({ error: `Today's free ${kind === 'speech' ? 'voice' : 'transcription'} is used up.`, limitReached: decision?.reason ?? 'store' }, { status: 429 })
	if (device.setCookie) res.headers.append('Set-Cookie', device.setCookie)
	return { refused: res }
}
