import 'server-only'
/**
 * Guards a hosted-demo endpoint that spends the owner's credits. When limits are on, counts this
 * request's use against the visitor's device, network and the global daily cap, and refuses it with
 * a 429 once a cap is reached. The client treats a refusal as "use the browser's voice instead".
 */
import { deviceFor, ipHashFor } from './device'
import { limitConfigFromEnv, takeUsage, type UsageKind } from './limits'

export async function guardUsage(req: Request, kind: Exclude<UsageKind, 'question'>, amount: number): Promise<{ refused?: Response; cookie?: string }> {
	const config = limitConfigFromEnv()
	if (!config.enabled) return {}
	const device = deviceFor(req)
	const decision = await takeUsage(kind, config[kind], device.id, ipHashFor(req), amount).catch((err) => {
		// A broken counter store must not turn into unlimited spend.
		console.error(`[loci] ${kind} limit check failed:`, err instanceof Error ? err.message : err)
		return null
	})
	if (decision?.ok) return { cookie: device.setCookie }
	const res = Response.json({ error: `Today's free ${kind === 'speech' ? 'voice' : 'transcription'} is used up.`, limitReached: decision?.reason ?? 'store' }, { status: 429 })
	if (device.setCookie) res.headers.append('Set-Cookie', device.setCookie)
	return { refused: res }
}
